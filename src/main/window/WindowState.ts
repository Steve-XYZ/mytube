import { screen, type BaseWindow } from 'electron';
import * as fs from 'fs';
import { writeFileAtomic } from '../utils/fsAtomic';
import log from 'electron-log/main';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SAVE_DEBOUNCE_MS = 500;
// Minimum part of the window that must remain visible on some display for a
// saved position to be trusted (guards against unplugged monitors).
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 40;

/**
 * Validate a persisted window state against the current displays. Returns
 * defaults for broken sizes and drops the position (so the OS centers the
 * window) when the saved coordinates no longer land on a visible display.
 */
export function sanitizeWindowState(
  state: unknown,
  displayAreas: DisplayArea[],
  minWidth: number,
  minHeight: number,
  defaults: { width: number; height: number },
): WindowState {
  const raw = (typeof state === 'object' && state !== null ? state : {}) as Record<string, unknown>;

  const width = Number.isFinite(raw.width) ? Math.max(minWidth, Math.floor(raw.width as number)) : defaults.width;
  const height = Number.isFinite(raw.height) ? Math.max(minHeight, Math.floor(raw.height as number)) : defaults.height;

  const result: WindowState = { width, height, isMaximized: raw.isMaximized === true };

  if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
    const x = Math.floor(raw.x as number);
    const y = Math.floor(raw.y as number);
    const visible = displayAreas.some(
      (area) =>
        x + MIN_VISIBLE_WIDTH <= area.x + area.width &&
        x + width - MIN_VISIBLE_WIDTH >= area.x &&
        y >= area.y - MIN_VISIBLE_HEIGHT &&
        y + MIN_VISIBLE_HEIGHT <= area.y + area.height,
    );
    if (visible) {
      result.x = x;
      result.y = y;
    }
  }

  return result;
}

export function readWindowState(
  filePath: string,
  minWidth: number,
  minHeight: number,
  defaults: { width: number; height: number },
): WindowState {
  let raw: unknown = null;
  try {
    if (fs.existsSync(filePath)) {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err: unknown) {
    log.warn('Failed to read window state:', err instanceof Error ? err.message : String(err));
  }

  const displayAreas = screen.getAllDisplays().map((display) => display.workArea);
  return sanitizeWindowState(raw, displayAreas, minWidth, minHeight, defaults);
}

/** Persist window bounds on move/resize (debounced) and on close. */
export function trackWindowState(window: BaseWindow, filePath: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    if (window.isDestroyed()) return;
    try {
      const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
      const state: WindowState = { ...bounds, isMaximized: window.isMaximized() };
      writeFileAtomic(filePath, JSON.stringify(state, null, 2));
    } catch (err: unknown) {
      log.warn('Failed to save window state:', err instanceof Error ? err.message : String(err));
    }
  };

  const scheduleSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      save();
    }, SAVE_DEBOUNCE_MS);
  };

  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('close', () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    save();
  });
}
