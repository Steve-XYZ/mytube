import { ipcMain, session as electronSession, type Session } from 'electron';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { IPC_CHANNELS } from '../../shared/types';
import { writeFileAtomic } from '../utils/fsAtomic';
import log from 'electron-log/main';

// Browser-like permission policy. Previously every site silently received
// clipboard-read, notifications, media, etc.; now sensitive permissions
// prompt the user per origin and the decision is remembered.

/** Harmless or required for normal playback — granted without asking. */
export const AUTO_ALLOWED_PERMISSIONS = [
  'fullscreen',
  'mediaKeySystem', // DRM (Widevine) — required for YouTube
  'clipboard-sanitized-write',
  'pointerLock', // Chrome grants this on user gesture without a prompt
];

/** Privacy-sensitive — the user decides once per origin. */
export const PROMPTED_PERMISSIONS = [
  'media', // camera / microphone (getUserMedia)
  'clipboard-read',
  'notifications',
];

export type PermissionPolicy = 'allow' | 'prompt' | 'deny';
export type PermissionDecision = 'granted' | 'denied';
export type SitePermissionStore = Record<string, Record<string, PermissionDecision>>;

export interface PermissionRequestPayload {
  id: string;
  origin: string;
  permission: string;
}

export function classifyPermission(permission: string): PermissionPolicy {
  if (AUTO_ALLOWED_PERMISSIONS.includes(permission)) return 'allow';
  if (PROMPTED_PERMISSIONS.includes(permission)) return 'prompt';
  return 'deny';
}

/** Origin a permission decision can be keyed on; null for non-web URLs. */
export function permissionOriginOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Validate a persisted store, dropping anything malformed. */
export function parseSitePermissionStore(raw: unknown): SitePermissionStore {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const store: SitePermissionStore = {};
  for (const [origin, decisions] of Object.entries(raw)) {
    if (permissionOriginOf(origin) !== origin) continue;
    if (typeof decisions !== 'object' || decisions === null) continue;
    const valid: Record<string, PermissionDecision> = {};
    for (const [permission, decision] of Object.entries(decisions)) {
      if (decision === 'granted' || decision === 'denied') {
        valid[permission] = decision;
      }
    }
    if (Object.keys(valid).length > 0) {
      store[origin] = valid;
    }
  }
  return store;
}

const PROMPT_TIMEOUT_MS = 2 * 60 * 1000;

type ShellSender = { send: (channel: string, ...args: unknown[]) => void };

export interface SitePermissionManagerOptions {
  storePath: string;
  /** The app shell that renders permission prompts. */
  shellSender: ShellSender;
  /** Requests from the shell itself are never prompted. */
  shellWebContentsId: number;
  session?: Session;
  promptTimeoutMs?: number;
}

interface PendingPrompt {
  payload: PermissionRequestPayload;
  callbacks: Array<(allow: boolean) => void>;
  timer: ReturnType<typeof setTimeout>;
}

export class SitePermissionManager {
  private storePath: string;
  private shellSender: ShellSender;
  private shellWebContentsId: number;
  private session: Session;
  private promptTimeoutMs: number;
  private store: SitePermissionStore;
  /** Keyed by `${origin}|${permission}` so a site retrying shares one prompt. */
  private pending: Map<string, PendingPrompt> = new Map();
  private pendingById: Map<string, string> = new Map();

  constructor(options: SitePermissionManagerOptions) {
    this.storePath = options.storePath;
    this.shellSender = options.shellSender;
    this.shellWebContentsId = options.shellWebContentsId;
    this.session = options.session ?? electronSession.defaultSession;
    this.promptTimeoutMs = options.promptTimeoutMs ?? PROMPT_TIMEOUT_MS;
    this.store = this.loadStore();

    this.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      this.handleRequest(webContents, permission, callback, details);
    });

    // Synchronous checks (e.g. Notification.permission, enumerateDevices).
    // Electron can only answer granted/denied here, so an undecided prompt
    // permission reads as denied until the user grants it once.
    this.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      switch (classifyPermission(permission)) {
        case 'allow':
          return true;
        case 'prompt': {
          if (webContents && webContents.id === this.shellWebContentsId) return false;
          const origin = permissionOriginOf(requestingOrigin);
          return origin !== null && this.store[origin]?.[permission] === 'granted';
        }
        default:
          return false;
      }
    });

    ipcMain.handle(IPC_CHANNELS.PERMISSION_RESPOND, (_event, id: string, allow: boolean) => {
      if (typeof id !== 'string' || typeof allow !== 'boolean') return;
      this.resolvePrompt(id, allow);
    });

    ipcMain.handle(IPC_CHANNELS.PERMISSION_CLEAR_ALL, () => {
      this.store = {};
      this.saveStore();
      log.info('Site permissions cleared');
      return true;
    });
  }

  private handleRequest(
    webContents: Electron.WebContents | null,
    permission: string,
    callback: (allow: boolean) => void,
    details: { requestingUrl?: string },
  ): void {
    const policy = classifyPermission(permission);
    if (policy === 'allow') {
      callback(true);
      return;
    }
    if (policy === 'deny') {
      log.info(`Permission denied by policy: ${permission}`);
      callback(false);
      return;
    }

    // The shell UI never needs prompted web permissions.
    if (webContents && webContents.id === this.shellWebContentsId) {
      callback(false);
      return;
    }

    const origin = permissionOriginOf(details.requestingUrl || webContents?.getURL());
    if (!origin) {
      log.info(`Permission ${permission} denied: no valid web origin`);
      callback(false);
      return;
    }

    const stored = this.store[origin]?.[permission];
    if (stored) {
      callback(stored === 'granted');
      return;
    }

    this.promptUser(origin, permission, callback);
  }

  private promptUser(origin: string, permission: string, callback: (allow: boolean) => void): void {
    const key = `${origin}|${permission}`;
    const existing = this.pending.get(key);
    if (existing) {
      existing.callbacks.push(callback);
      return;
    }

    const payload: PermissionRequestPayload = { id: randomUUID(), origin, permission };
    const timer = setTimeout(() => {
      // No answer: deny this request but do not remember the decision.
      this.finishPrompt(key, false, false);
    }, this.promptTimeoutMs);

    this.pending.set(key, { payload, callbacks: [callback], timer });
    this.pendingById.set(payload.id, key);
    this.shellSender.send(IPC_CHANNELS.PERMISSION_REQUEST, payload);
    log.info(`Permission prompt: ${origin} requests ${permission}`);
  }

  private resolvePrompt(id: string, allow: boolean): void {
    const key = this.pendingById.get(id);
    if (!key) return;
    this.finishPrompt(key, allow, true);
  }

  private finishPrompt(key: string, allow: boolean, remember: boolean): void {
    const prompt = this.pending.get(key);
    if (!prompt) return;

    clearTimeout(prompt.timer);
    this.pending.delete(key);
    this.pendingById.delete(prompt.payload.id);

    if (remember) {
      const { origin, permission } = prompt.payload;
      this.store[origin] = { ...this.store[origin], [permission]: allow ? 'granted' : 'denied' };
      this.saveStore();
      log.info(`Permission ${allow ? 'granted' : 'denied'} for ${origin}: ${permission}`);
    }

    for (const callback of prompt.callbacks) {
      callback(allow);
    }
  }

  private loadStore(): SitePermissionStore {
    try {
      if (!fs.existsSync(this.storePath)) return {};
      return parseSitePermissionStore(JSON.parse(fs.readFileSync(this.storePath, 'utf-8')));
    } catch (err: unknown) {
      log.warn('Failed to load site permissions:', err instanceof Error ? err.message : String(err));
      return {};
    }
  }

  private saveStore(): void {
    try {
      writeFileAtomic(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (err: unknown) {
      log.warn('Failed to save site permissions:', err instanceof Error ? err.message : String(err));
    }
  }

  destroy(): void {
    for (const key of Array.from(this.pending.keys())) {
      this.finishPrompt(key, false, false);
    }
    this.session.setPermissionRequestHandler(null);
    this.session.setPermissionCheckHandler(null);
    ipcMain.removeHandler(IPC_CHANNELS.PERMISSION_RESPOND);
    ipcMain.removeHandler(IPC_CHANNELS.PERMISSION_CLEAR_ALL);
  }
}
