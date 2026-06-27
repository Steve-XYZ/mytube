import { afterEach, describe, expect, it } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/types';
import { buildGoogleAuthUrl, createCodeChallenge, GoogleAuthManager } from '../../src/main/auth/GoogleAuthManager';

describe('GoogleAuthManager', () => {
  afterEach(() => {
    delete process.env.MYTUBE_GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    ipcMain.removeHandler(IPC_CHANNELS.AUTH_GOOGLE_STATUS);
    ipcMain.removeHandler(IPC_CHANNELS.AUTH_GOOGLE_SIGN_IN);
    ipcMain.removeHandler(IPC_CHANNELS.AUTH_GOOGLE_SIGN_OUT);
  });

  it('returns a signed-out status when Google OAuth is not configured', async () => {
    const manager = new GoogleAuthManager();

    await expect(manager.getStatus()).resolves.toEqual({
      configured: false,
      signedIn: false,
      error: 'Set MYTUBE_GOOGLE_OAUTH_CLIENT_ID to enable Google sign-in.',
    });

    manager.destroy();
  });

  it('registers Google auth IPC handlers', () => {
    const manager = new GoogleAuthManager();
    const handlers = (ipcMain as unknown as { _handlers: Map<string, unknown> })._handlers;

    expect(handlers.has(IPC_CHANNELS.AUTH_GOOGLE_STATUS)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.AUTH_GOOGLE_SIGN_IN)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.AUTH_GOOGLE_SIGN_OUT)).toBe(true);

    manager.destroy();
  });

  it('builds the RFC 7636 S256 code challenge', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    expect(createCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('builds a native-app Google auth URL with PKCE and YouTube scope', () => {
    const authUrl = new URL(
      buildGoogleAuthUrl({
        clientId: 'client-id.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:3456/oauth/google/callback',
        state: 'state-value',
        codeChallenge: 'challenge-value',
      }),
    );

    expect(authUrl.origin).toBe('https://accounts.google.com');
    expect(authUrl.searchParams.get('client_id')).toBe('client-id.apps.googleusercontent.com');
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3456/oauth/google/callback');
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('access_type')).toBe('offline');
    expect(authUrl.searchParams.get('prompt')).toBe('consent');
    expect(authUrl.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/youtube.readonly');
  });
});
