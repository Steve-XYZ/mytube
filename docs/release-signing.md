# Release Signing and Notarization

MyTube can build unsigned local packages without credentials. Public release
builds should be signed and, on macOS, notarized.

## Preflight

Run:

```bash
pnpm run release:check
```

For a strict release credential check:

```bash
MYTUBE_REQUIRE_SIGNING=1 pnpm run release:check
```

For a single-platform strict check:

```bash
MYTUBE_RELEASE_TARGET=mac MYTUBE_REQUIRE_SIGNING=1 pnpm run release:check
MYTUBE_RELEASE_TARGET=win MYTUBE_REQUIRE_SIGNING=1 pnpm run release:check
```

Tagged release workflow runs use the single-platform strict checks so public tag
builds fail instead of uploading unsigned artifacts when required credentials are
missing. Manual `workflow_dispatch` runs remain useful for unsigned packaging
smoke tests.

## macOS Signing

Electron Builder signs macOS builds automatically when these environment
variables are present:

```bash
CSC_LINK=/path/to/developer-id-application.p12
CSC_KEY_PASSWORD=...
```

In GitHub Actions, use repository secrets:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`

## macOS Notarization

Electron Builder runs its native `@electron/notarize` integration after macOS
signing because `mac.notarize` is enabled in `electron-builder.yml`. It
notarizes only when credentials are present, so local unsigned builds still work.

Supported credential strategies:

Apple ID app-specific password:

```bash
APPLE_ID=developer@example.com
APPLE_APP_SPECIFIC_PASSWORD=...
APPLE_TEAM_ID=TEAMID1234
```

App Store Connect API key:

```bash
APPLE_API_KEY=/path/to/AuthKey_KEYID.p8
APPLE_API_KEY_ID=KEYID
APPLE_API_ISSUER=issuer-uuid
```

Keychain profile:

```bash
APPLE_KEYCHAIN_PROFILE=mytube-notary-profile
APPLE_KEYCHAIN=/optional/path/to/keychain
```

To fail macOS release builds when notarization credentials are missing:

```bash
MYTUBE_RELEASE_TARGET=mac MYTUBE_REQUIRE_SIGNING=1 pnpm run release:check
```

## Windows Signing

Electron Builder uses Authenticode credentials when these variables are present:

```bash
CSC_LINK=/path/to/windows-code-signing-cert.p12
CSC_KEY_PASSWORD=...
```

The release workflow accepts separate Windows secrets and maps them at build
time:

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

## Current Limits

- Actual signing requires private certificates and Apple/Windows account
  credentials that are not stored in the repository.
- Notarization can only complete on macOS with valid Apple credentials.
- Manual `workflow_dispatch` release runs can still produce unsigned artifacts
  when credentials are intentionally absent.
