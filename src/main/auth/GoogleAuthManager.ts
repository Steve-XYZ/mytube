import { app, ipcMain, safeStorage, shell } from 'electron';
import { createHash, randomBytes } from 'crypto';
import { createServer } from 'http';
import * as fs from 'fs/promises';
import * as path from 'path';
import log from 'electron-log/main';
import { GoogleAuthStatus, IPC_CHANNELS } from '../../shared/types';

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

type StoredGoogleAuth = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
  tokenType?: string;
  profile?: {
    email?: string;
    name?: string;
    picture?: string;
    youtubeChannelTitle?: string;
  };
};

type StoredGoogleAuthEnvelope = {
  version: 2;
  encrypted: true;
  cipherText: string;
};

type GoogleUserInfo = {
  email?: string;
  name?: string;
  picture?: string;
};

type YouTubeChannelsResponse = {
  items?: Array<{
    snippet?: {
      title?: string;
    };
  }>;
};

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
const GOOGLE_AUTH_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/youtube.readonly'];
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const OAUTH_TIMEOUT_MS = 120_000;

export class GoogleAuthManager {
  private readonly authFilePath: string;
  private readonly clientId: string | undefined;

  constructor() {
    this.authFilePath = path.join(app.getPath('userData'), 'google-auth.json');
    this.clientId = process.env.MYTUBE_GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
    this.setupIpcHandlers();
  }

  private setupIpcHandlers(): void {
    ipcMain.handle(IPC_CHANNELS.AUTH_GOOGLE_STATUS, () => this.getStatus());
    ipcMain.handle(IPC_CHANNELS.AUTH_GOOGLE_SIGN_IN, () => this.signIn());
    ipcMain.handle(IPC_CHANNELS.AUTH_GOOGLE_SIGN_OUT, () => this.signOut());
  }

  async getStatus(): Promise<GoogleAuthStatus> {
    if (!this.clientId) {
      return {
        configured: false,
        signedIn: false,
        error: 'Set MYTUBE_GOOGLE_OAUTH_CLIENT_ID to enable Google sign-in.',
      };
    }

    const stored = await this.readStoredAuth();
    if (!stored) {
      return { configured: true, signedIn: false };
    }

    try {
      const refreshed = await this.ensureFreshToken(stored);
      return this.toStatus(refreshed);
    } catch (err: unknown) {
      log.warn('Google auth status refresh failed:', getErrorMessage(err));
      return {
        configured: true,
        signedIn: false,
        error: 'Google session needs to be reconnected.',
      };
    }
  }

  async signIn(): Promise<GoogleAuthStatus> {
    if (!this.clientId) {
      return this.getStatus();
    }

    const state = randomUrlSafeString(32);
    const codeVerifier = randomUrlSafeString(64);
    const codeChallenge = createCodeChallenge(codeVerifier);

    try {
      const { code, redirectUri } = await this.requestAuthorizationCode({
        state,
        codeChallenge,
      });
      const token = await this.exchangeAuthorizationCode(code, redirectUri, codeVerifier);
      const stored = await this.buildStoredAuth(token);
      await this.writeStoredAuth(stored);
      return this.toStatus(stored);
    } catch (err: unknown) {
      log.warn('Google sign-in failed:', getErrorMessage(err));
      return {
        configured: true,
        signedIn: false,
        error: getErrorMessage(err),
      };
    }
  }

  async signOut(): Promise<GoogleAuthStatus> {
    try {
      await fs.rm(this.authFilePath, { force: true });
    } catch (err: unknown) {
      log.warn('Failed to clear Google auth file:', getErrorMessage(err));
    }
    return { configured: Boolean(this.clientId), signedIn: false };
  }

  destroy(): void {
    ipcMain.removeHandler(IPC_CHANNELS.AUTH_GOOGLE_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.AUTH_GOOGLE_SIGN_IN);
    ipcMain.removeHandler(IPC_CHANNELS.AUTH_GOOGLE_SIGN_OUT);
  }

  private async requestAuthorizationCode({
    state,
    codeChallenge,
  }: {
    state: string;
    codeChallenge: string;
  }): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let redirectUri = '';
      let timeout: NodeJS.Timeout | undefined;

      const server = createServer((request, response) => {
        const requestUrl = new URL(request.url || '/', redirectUri || 'http://127.0.0.1');
        if (requestUrl.pathname !== '/oauth/google/callback') {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }

        const callbackState = requestUrl.searchParams.get('state');
        if (callbackState !== state) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(buildCallbackHtml('Google sign-in failed', 'Invalid OAuth state. You can close this tab.'));
          finish(new Error('Invalid OAuth state.'));
          return;
        }

        const oauthError = requestUrl.searchParams.get('error');
        if (oauthError) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(buildCallbackHtml('Google sign-in cancelled', 'You can close this tab and return to MyTube.'));
          finish(new Error(`Google sign-in cancelled: ${oauthError}`));
          return;
        }

        const code = requestUrl.searchParams.get('code');
        if (!code) {
          response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(
            buildCallbackHtml('Google sign-in failed', 'Missing authorization code. You can close this tab.'),
          );
          finish(new Error('Missing Google authorization code.'));
          return;
        }

        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(buildCallbackHtml('Google sign-in complete', 'You can close this tab and return to MyTube.'));
        finish(null, { code, redirectUri });
      });

      function finish(error: Error | null, result?: { code: string; redirectUri: string }) {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        server.close();
        if (error) {
          reject(error);
        } else if (result) {
          resolve(result);
        }
      }

      server.on('error', (error) => finish(error));
      server.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        if (!address || typeof address === 'string') {
          finish(new Error('Unable to start local Google sign-in callback server.'));
          return;
        }

        redirectUri = `http://127.0.0.1:${address.port}/oauth/google/callback`;
        const authUrl = buildGoogleAuthUrl({
          clientId: this.clientId ?? '',
          redirectUri,
          state,
          codeChallenge,
        });

        timeout = setTimeout(() => {
          finish(new Error('Google sign-in timed out.'));
        }, OAUTH_TIMEOUT_MS);

        shell.openExternal(authUrl).catch((error: unknown) => finish(asError(error)));
      });
    });
  }

  private async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
    codeVerifier: string,
  ): Promise<TokenResponse> {
    const token = await postGoogleToken({
      client_id: this.clientId ?? '',
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    if (!token.access_token) {
      throw new Error(token.error_description || token.error || 'Google did not return an access token.');
    }
    return token;
  }

  private async refreshToken(stored: StoredGoogleAuth): Promise<StoredGoogleAuth> {
    if (!stored.refreshToken) {
      throw new Error('Google refresh token is unavailable.');
    }

    const token = await postGoogleToken({
      client_id: this.clientId ?? '',
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    });
    if (!token.access_token) {
      throw new Error(token.error_description || token.error || 'Google token refresh failed.');
    }

    const updated: StoredGoogleAuth = {
      ...stored,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || stored.refreshToken,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      tokenType: token.token_type || stored.tokenType,
      scopes: parseScopes(token.scope) || stored.scopes,
    };
    await this.writeStoredAuth(updated);
    return updated;
  }

  private async ensureFreshToken(stored: StoredGoogleAuth): Promise<StoredGoogleAuth> {
    if (stored.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return stored;
    }
    return this.refreshToken(stored);
  }

  private async buildStoredAuth(token: TokenResponse): Promise<StoredGoogleAuth> {
    const accessToken = token.access_token;
    if (!accessToken) {
      throw new Error('Google did not return an access token.');
    }

    const profile = await fetchGoogleProfile(accessToken);
    return {
      accessToken,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
      scopes: parseScopes(token.scope) || [...GOOGLE_AUTH_SCOPES],
      tokenType: token.token_type,
      profile,
    };
  }

  private async readStoredAuth(): Promise<StoredGoogleAuth | null> {
    try {
      const raw = await fs.readFile(this.authFilePath, 'utf-8');
      return decodeGoogleAuthFromStorage(JSON.parse(raw));
    } catch (err: unknown) {
      if (getErrorCode(err) !== 'ENOENT') {
        log.warn('Failed to read Google auth file:', getErrorMessage(err));
      }
      return null;
    }
  }

  private async writeStoredAuth(stored: StoredGoogleAuth): Promise<void> {
    await fs.mkdir(path.dirname(this.authFilePath), { recursive: true });
    await fs.writeFile(this.authFilePath, JSON.stringify(encodeGoogleAuthForStorage(stored), null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await fs.chmod(this.authFilePath, 0o600).catch(() => undefined);
  }

  private toStatus(stored: StoredGoogleAuth): GoogleAuthStatus {
    return {
      configured: true,
      signedIn: true,
      email: stored.profile?.email,
      name: stored.profile?.name,
      picture: stored.profile?.picture,
      youtubeChannelTitle: stored.profile?.youtubeChannelTitle,
      scopes: stored.scopes,
    };
  }
}

export function createCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}

export function buildGoogleAuthUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_AUTH_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export function encodeGoogleAuthForStorage(stored: StoredGoogleAuth): StoredGoogleAuth | StoredGoogleAuthEnvelope {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('Electron safeStorage encryption is unavailable; Google auth file will use filesystem permissions only.');
    return stored;
  }

  return {
    version: 2,
    encrypted: true,
    cipherText: safeStorage.encryptString(JSON.stringify(stored)).toString('base64'),
  };
}

export function decodeGoogleAuthFromStorage(payload: unknown): StoredGoogleAuth | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (isEncryptedEnvelope(payload)) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Google auth file is encrypted but local decryption is unavailable.');
    }
    const decrypted = safeStorage.decryptString(Buffer.from(payload.cipherText, 'base64'));
    return parseStoredGoogleAuth(JSON.parse(decrypted));
  }

  return parseStoredGoogleAuth(payload);
}

async function postGoogleToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = (await response.json()) as TokenResponse;
  if (!response.ok) {
    throw new Error(json.error_description || json.error || `Google token request failed (${response.status}).`);
  }
  return json;
}

async function fetchGoogleProfile(accessToken: string): Promise<StoredGoogleAuth['profile']> {
  const userResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) {
    throw new Error(`Google profile request failed (${userResponse.status}).`);
  }

  const userInfo = (await userResponse.json()) as GoogleUserInfo;
  const youtubeChannelTitle = await fetchYouTubeChannelTitle(accessToken);
  return {
    email: userInfo.email,
    name: userInfo.name,
    picture: userInfo.picture,
    youtubeChannelTitle,
  };
}

async function fetchYouTubeChannelTitle(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch(YOUTUBE_CHANNELS_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      log.warn(`YouTube channel lookup failed (${response.status})`);
      return undefined;
    }
    const body = (await response.json()) as YouTubeChannelsResponse;
    return body.items?.[0]?.snippet?.title;
  } catch (err: unknown) {
    log.warn('YouTube channel lookup failed:', getErrorMessage(err));
    return undefined;
  }
}

function buildCallbackHtml(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function randomUrlSafeString(bytes: number): string {
  return base64UrlEncode(randomBytes(bytes));
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseScopes(scope: string | undefined): string[] | undefined {
  if (!scope) return undefined;
  return scope.split(/\s+/).filter(Boolean);
}

function parseStoredGoogleAuth(payload: unknown): StoredGoogleAuth | null {
  if (!isRecord(payload) || typeof payload.accessToken !== 'string' || typeof payload.expiresAt !== 'number') {
    return null;
  }

  return {
    accessToken: payload.accessToken,
    refreshToken: typeof payload.refreshToken === 'string' ? payload.refreshToken : undefined,
    expiresAt: payload.expiresAt,
    scopes: Array.isArray(payload.scopes) ? payload.scopes.filter((scope) => typeof scope === 'string') : [],
    tokenType: typeof payload.tokenType === 'string' ? payload.tokenType : undefined,
    profile: parseStoredProfile(payload.profile),
  };
}

function parseStoredProfile(payload: unknown): StoredGoogleAuth['profile'] {
  if (!isRecord(payload)) {
    return undefined;
  }

  return {
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
    youtubeChannelTitle: typeof payload.youtubeChannelTitle === 'string' ? payload.youtubeChannelTitle : undefined,
  };
}

function isEncryptedEnvelope(payload: Record<string, unknown>): payload is StoredGoogleAuthEnvelope {
  return payload.version === 2 && payload.encrypted === true && typeof payload.cipherText === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getErrorCode(err: unknown): unknown {
  return isRecord(err) ? err.code : undefined;
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
