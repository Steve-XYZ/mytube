const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'electron-builder.yml',
  'build/icon.icns',
  'build/icon.ico',
  'build/entitlements.mac.plist',
  'scripts/verify-binaries.cjs',
];

const problems = [];
for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    problems.push(`missing required release file: ${relativePath}`);
  }
}

const builderConfig = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
for (const expected of ['afterPack: ./scripts/verify-binaries.cjs', 'notarize: true']) {
  if (!builderConfig.includes(expected)) {
    problems.push(`electron-builder.yml must include "${expected}"`);
  }
}

const isStrict = process.env.MYTUBE_REQUIRE_SIGNING === '1';
const releaseTarget = process.env.MYTUBE_RELEASE_TARGET;
const requireMacSigning = !releaseTarget || releaseTarget === 'mac';
const requireWindowsSigning = !releaseTarget || releaseTarget === 'win';
const hasMacSigning = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
const hasApplePassword = Boolean(
  process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID,
);
const hasAppleApiKey = Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER);
const hasAppleKeychain = Boolean(process.env.APPLE_KEYCHAIN_PROFILE);
const hasWindowsSigning = Boolean(process.env.WIN_CSC_LINK && process.env.WIN_CSC_KEY_PASSWORD);

if (releaseTarget && releaseTarget !== 'mac' && releaseTarget !== 'win') {
  problems.push('MYTUBE_RELEASE_TARGET must be either "mac" or "win" when set');
}

if (isStrict) {
  if (requireMacSigning && !hasMacSigning) {
    problems.push('strict signing requires CSC_LINK and CSC_KEY_PASSWORD for macOS signing');
  }
  if (requireMacSigning && !hasApplePassword && !hasAppleApiKey && !hasAppleKeychain) {
    problems.push('strict signing requires Apple notarization credentials');
  }
  if (requireWindowsSigning && !hasWindowsSigning) {
    problems.push('strict signing requires WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD for Windows signing');
  }
}

if (problems.length) {
  console.error('Release environment check failed:');
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

console.log('Release environment check passed.');
console.log(`macOS signing credentials: ${hasMacSigning ? 'present' : 'not configured'}`);
console.log(
  `Apple notarization credentials: ${hasApplePassword || hasAppleApiKey || hasAppleKeychain ? 'present' : 'not configured'}`,
);
console.log(`Windows signing credentials: ${hasWindowsSigning ? 'present' : 'not configured'}`);
console.log(`Release target: ${releaseTarget || 'all'}`);
