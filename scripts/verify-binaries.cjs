// electron-builder afterPack hook.
//
// Guarantees a packaged build can never silently ship without its native
// helpers. If yt-dlp/ffmpeg/ffprobe are missing, empty, or (on macOS) built for
// the wrong architecture, the build fails here instead of producing a broken
// DMG/installer. This is the safety net behind the per-arch bin/ staging.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// electron-builder's Arch enum -> folder/name used throughout this project.
const ARCH_NAMES = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
// Project arch name -> the arch token `lipo -archs` prints for a Mach-O slice.
const LIPO_ARCH = { x64: 'x86_64', arm64: 'arm64', ia32: 'i386' };

function resourcesBinDir(context) {
  const { appOutDir, electronPlatformName } = context;
  if (electronPlatformName === 'darwin') {
    const productFilename = context.packager.appInfo.productFilename;
    return path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources', 'bin');
  }
  // win32 / linux place resources directly under the output dir.
  return path.join(appOutDir, 'resources', 'bin');
}

function machoArchs(filePath) {
  // Only meaningful (and only available) on a macOS host. Returns null when the
  // check can't run so callers fall back to a presence-only check.
  try {
    return execFileSync('lipo', ['-archs', filePath], { encoding: 'utf8' }).trim().split(/\s+/);
  } catch {
    return null;
  }
}

module.exports = async function verifyBinaries(context) {
  const { electronPlatformName, arch } = context;
  const archName = ARCH_NAMES[arch] != null ? ARCH_NAMES[arch] : String(arch);
  const isWin = electronPlatformName === 'win32';
  const ext = isWin ? '.exe' : '';
  const binDir = resourcesBinDir(context);

  const required = ['yt-dlp', 'ffmpeg', 'ffprobe'].map((name) => `${name}${ext}`);
  const problems = [];

  for (const name of required) {
    const filePath = path.join(binDir, name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      problems.push(`missing: ${name}`);
      continue;
    }
    if (!stat.isFile() || stat.size === 0) {
      problems.push(`empty file: ${name}`);
      continue;
    }

    // Architecture sanity check for macOS (the cross-platform bug this guards).
    if (electronPlatformName === 'darwin' && archName !== 'universal') {
      const want = LIPO_ARCH[archName];
      const slices = machoArchs(filePath);
      if (want && slices && !slices.includes(want)) {
        problems.push(`${name}: wrong arch (target ${archName}/${want}, binary has [${slices.join(', ')}])`);
      }
    }
  }

  if (problems.length) {
    throw new Error(
      `[verify-binaries] ${electronPlatformName}/${archName} package is broken — ${binDir}:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\nStage the binaries first (e.g. "pnpm run setup:bins:mac && pnpm run setup:pot") and rebuild.`,
    );
  }

  // The PO-token provider is optional at runtime (the app falls back without it),
  // so a missing provider is a warning, not a hard failure.
  const potEntry = path.join(binDir, 'bgutil-ytdlp-pot-provider', 'server', 'build', 'generate_once.js');
  if (!fs.existsSync(potEntry)) {
    console.warn(
      `  ⚠ verify-binaries: PO-token provider not bundled for ${electronPlatformName}/${archName} ` +
        `(run "pnpm run setup:pot"). YouTube downloads may be limited.`,
    );
  }

  console.log(`  • verify-binaries: ${electronPlatformName}/${archName} OK (${required.join(', ')})`);
};
