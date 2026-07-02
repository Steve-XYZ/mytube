#!/usr/bin/env node
// Packaged-build E2E smoke runner.
//
// Stages mock media binaries into bin/<os>/<arch>/ (unless real ones are
// already staged), packs the app with `electron-builder --dir`, then runs
// tests/e2e/packaged.spec.ts against the packed executable. With mock
// binaries the suite also exercises a full download through resources/bin,
// proving packaged binary resolution without touching the network.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const MOCK_YTDLP = path.join(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'bin', 'yt-dlp');
const MOCK_MARKER = '.e2e-mocks';

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Command failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

function platformBinDir() {
  const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return path.join(REPO_ROOT, 'bin', os, arch);
}

/** Returns true when the package will contain mock binaries. */
function stageMockBinaries() {
  const binDir = platformBinDir();
  const marker = path.join(binDir, MOCK_MARKER);
  const hasRealBins = fs.existsSync(path.join(binDir, 'yt-dlp')) && !fs.existsSync(marker);

  if (hasRealBins) {
    console.log(`Using real staged binaries in ${binDir}; the download smoke test will be skipped.`);
    return false;
  }

  if (process.platform === 'win32') {
    console.error('Mock binary staging uses shebang scripts and does not support Windows yet.');
    console.error('Stage real binaries with "pnpm run setup:bins:win" and re-run.');
    process.exit(1);
  }

  console.log(`Staging mock media binaries in ${binDir}`);
  fs.mkdirSync(binDir, { recursive: true });
  fs.copyFileSync(MOCK_YTDLP, path.join(binDir, 'yt-dlp'));
  for (const name of ['ffmpeg', 'ffprobe']) {
    fs.writeFileSync(path.join(binDir, name), `#!/bin/sh\necho "${name} version 7.0-mytube-e2e-mock"\nexit 0\n`);
  }
  for (const name of ['yt-dlp', 'ffmpeg', 'ffprobe']) {
    fs.chmodSync(path.join(binDir, name), 0o755);
  }
  fs.writeFileSync(marker, 'binaries staged by scripts/run-packaged-e2e.cjs\n');
  return true;
}

function findPackagedExecutable() {
  const release = path.join(REPO_ROOT, 'release');
  const candidates =
    process.platform === 'darwin'
      ? [
          path.join(release, 'mac-arm64', 'MyTube.app', 'Contents', 'MacOS', 'MyTube'),
          path.join(release, 'mac', 'MyTube.app', 'Contents', 'MacOS', 'MyTube'),
        ]
      : process.platform === 'win32'
        ? [path.join(release, 'win-unpacked', 'MyTube.exe')]
        : [path.join(release, 'linux-unpacked', 'mytube')];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    console.error(`No packaged executable found. Checked:\n  ${candidates.join('\n  ')}`);
    process.exit(1);
  }
  return found;
}

const mocked = stageMockBinaries();

run('pnpm', ['run', 'build:all']);
run('pnpm', ['exec', 'electron-builder', '--dir']);

const executable = findPackagedExecutable();
console.log(`\nPackaged executable: ${executable}`);

const result = spawnSync('pnpm', ['exec', 'playwright', 'test', 'tests/e2e/packaged.spec.ts'], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    MYTUBE_PACKAGED_APP: executable,
    MYTUBE_PACKAGED_MOCK_BINS: mocked ? '1' : '0',
  },
});
process.exit(result.status || 0);
