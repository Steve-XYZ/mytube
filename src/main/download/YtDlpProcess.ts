import { spawn, type ChildProcess } from 'child_process';

const VERSION_PROBE_TIMEOUT_MS = 2_000;

/** Probe yt-dlp without blocking Electron's Main event loop. */
export function probeYtDlpVersion(
  binaryPath: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = VERSION_PROBE_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    let child: ChildProcess;

    const finish = (version: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(version);
    };

    const timeout = setTimeout(() => {
      child?.kill();
      finish(null);
    }, timeoutMs);

    try {
      child = spawn(binaryPath, ['--version'], {
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        if (stdout.length < 1024) stdout += chunk;
      });
      child.once('error', () => finish(null));
      child.once('close', (code) => finish(code === 0 ? stdout.trim() || null : null));
    } catch {
      finish(null);
    }
  });
}
