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
- Packaging/signing/notarization has not been fully verified.
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
- Verify `pnpm run dev:electron` starts and basic navigation works.
- Verify video download and image download flows.
- Verify packaging through `pnpm run pack`.
- Define signing and notarization process before public release.
