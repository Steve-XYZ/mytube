# MyTube

MyTube is an Electron desktop app that combines a Chromium-based browser shell with media download tools. The app is built with Electron, React, TypeScript, Vite, and Vitest.

## Current Status

This repository is past the first stabilization pass. The core Electron app starts locally, the TypeScript/test/lint/build gates pass, and the main video/image download flows have been smoke-tested with local media binaries. It should still be treated as pre-release software until CI, E2E coverage, packaging, and signing are completed.

Working areas:

- Electron main process with `BaseWindow` and `WebContentsView` tabs.
- React renderer shell with tabs, navigation, find-in-page, settings, downloads, image gallery, and toast UI.
- Preload bridge using `contextBridge`.
- Video/audio download wrapper around packaged `yt-dlp`, `ffmpeg`, and `ffprobe`.
- YouTube public-mode extraction with optional local PO-token provider support.
- Image scanning, batch download progress, and Finder reveal support.
- JSON-backed settings and download history.
- Unit tests for core main-process logic.

Known gaps:

- `bin/` is generated locally and ignored by git; `pnpm run setup` must populate it before media download flows work on a fresh checkout.
- Notarization and signed release publishing still require project credentials.
- There is no CI workflow yet.
- There is no automated E2E coverage yet.
- YouTube can still reject anonymous guest sessions for some videos/networks before downloadable formats are returned.
- The PO-token provider is an external setup-time component and should be reviewed before production distribution.
- Test code still uses a few casts around mocked Electron and Node APIs.

## Requirements

- Node.js compatible with the current dependency set.
- Node.js 20 or newer is required for the optional YouTube PO-token provider installed by `pnpm run setup`.
- pnpm 10.x. The repo currently declares `pnpm@10.29.3`.
- macOS or Windows for full Electron app usage.

## Setup

```bash
pnpm install
pnpm run setup
```

If Electron fails to install because pnpm blocked dependency build scripts, make sure `pnpm-workspace.yaml` includes the allowed build dependencies and reinstall:

```bash
rm -rf node_modules
pnpm install
```

## Development

Renderer-only Vite preview:

```bash
pnpm run dev
```

Electron development mode:

```bash
pnpm run dev:electron
```

Production-style local start:

```bash
pnpm run start
```

### Google Account Sign-In

Google account connection uses the system browser with native-app OAuth, PKCE,
and a loopback redirect such as `http://127.0.0.1:<port>/oauth/google/callback`.
It does not sign the embedded browser tab into google.com or youtube.com.

Create a Google OAuth client for a desktop/native app, enable the YouTube Data
API if channel lookup is needed, and launch MyTube with:

```bash
MYTUBE_GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com" pnpm run dev:electron
```

The connected account status is shown in Settings -> Account. Tokens are stored
under Electron `userData` in `google-auth.json`, encrypted with Electron
`safeStorage` when local OS-backed encryption is available, and written with
restricted file permissions as a fallback.

## Validation

Run the narrow checks first:

```bash
pnpm run test
pnpm run typecheck
pnpm run lint
pnpm run format:check
```

Run the full build and local Electron smoke:

```bash
pnpm run build:all
pnpm run dev:electron
```

Package locally:

```bash
pnpm run pack
```

Run `pnpm run setup` on the same operating system and architecture that will be
packaged. The media binaries and the PO-token provider include native runtime
files, so a macOS `bin/` directory must not be reused for a Windows package (or
vice versa).

Regenerate all platform icons from the canonical root `image.png`:

```bash
pnpm run icons
```

Icon generation uses the locked `sharp` development dependency and must run on
macOS with `iconutil` available. It creates `build/icon.icns`, a multiresolution
`build/icon.ico`, and transparent Linux PNGs at 16, 32, 48, 64, 128, 256, and
512 pixels.

## Architecture Notes

- Main-process code lives in `src/main`.
- Renderer code lives in `src/renderer`.
- The preload bridge lives in `src/preload`.
- Shared IPC channels and types live in `src/shared`.
- System-level work, file access, child processes, and Electron APIs must stay in the main process.
- Renderer-to-main communication should go through the preload `contextBridge`.
- Browser tab web contents should remain sandboxed with `contextIsolation: true` and `nodeIntegration: false`.

## Persistence

Settings and download history are currently JSON-backed under Electron `userData`.

- Settings: `settings.json`
- Downloads: `downloads.json`

The repository guidance mentions `electron-store` and SQLite as target architecture, but the current implementation intentionally uses simpler JSON persistence while the app is being stabilized.

## Media Binaries

`pnpm run setup` creates the ignored `bin/` directory and downloads/copies:

- `yt-dlp`
- `ffmpeg`
- `ffprobe`
- `bgutil-ytdlp-pot-provider` for YouTube PO-token support

The packaged app expects these files through `electron-builder.yml` `extraResources`.
The provider setup compiles from its pinned source revision, then keeps only its
built server, production dependencies, and yt-dlp plugin in `bin/`. Source,
tests, Git metadata, and provider development dependencies are not packaged.
Packaged builds run the provider with Electron's bundled Node.js runtime, so
end users do not need a separate Node.js installation. The setup script applies
a narrow compatibility patch to the generated provider entry point so its CLI
parser treats Electron's Node mode like a normal Node.js process.

YouTube currently enforces Proof-of-Origin tokens for some clients and traffic patterns. MyTube does not rely on Google login inside the Electron browser because Google can mark embedded browsers as untrusted. Instead, the main process calls `yt-dlp` in public mode first, skips exporting YouTube cookies by default, and uses the local PO-token provider when `pnpm run setup` has installed it.

Current media validation evidence:

- Image downloads save under `~/Downloads/MyTube/Images` in development and report success/failure in the UI.
- A known public YouTube video downloaded successfully through `yt-dlp` with the PO-token provider enabled.
- A 44:34 YouTube video was used as a metadata smoke test and returned 40 formats without hitting the previous 30-second app timeout.
- Some YouTube videos can still return `LOGIN_REQUIRED` even with PO-token support; those are upstream guest-session/IP restrictions rather than a supported login flow inside the app.

## Release Readiness Checklist

- Add CI for test, typecheck, lint, format, and build.
- Verify `pnpm install` on a clean macOS and Windows machine.
- Verify `pnpm run setup:bins` on supported platforms.
- Run `pnpm run icons` after changing `image.png`.
- Verify `pnpm run dev:electron` starts and basic navigation works.
- Verify video download and image download flows.
- Verify macOS and Windows packaging on their native platforms.
- Configure signing and notarization credentials before public release.
