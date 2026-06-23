# MyTube

MyTube is an Electron desktop app that combines a Chromium-based browser shell with media download tools. The app is built with Electron, React, TypeScript, Vite, and Vitest.

## Current Status

This repository is in active stabilization. The core app structure exists and the TypeScript/test/build gates pass locally, but it should not be treated as production-ready yet.

Working areas:

- Electron main process with `BaseWindow` and `WebContentsView` tabs.
- React renderer shell with tabs, navigation, find-in-page, settings, downloads, image gallery, and toast UI.
- Preload bridge using `contextBridge`.
- Video download wrapper around packaged `yt-dlp`.
- Image scanning and download support.
- JSON-backed settings and download history.
- Unit tests for core main-process logic.

Known gaps:

- Electron needs its postinstall script to run successfully after install.
- `bin/` is generated locally and must be populated with `yt-dlp`, `ffmpeg`, `ffprobe`, and the optional YouTube PO-token provider before the broadest media download coverage works.
- Packaging/signing/notarization has not been fully verified.
- There is no CI workflow yet.
- Test code still uses a few casts around mocked Electron and Node APIs.

## Requirements

- Node.js compatible with the current dependency set.
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

Run the full build:

```bash
pnpm run build:all
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

## Release Readiness Checklist

- Add CI for test, typecheck, lint, format, and build.
- Verify `pnpm install` on a clean macOS and Windows machine.
- Verify `pnpm run setup:bins` on supported platforms.
- Verify `pnpm run dev:electron` starts and basic navigation works.
- Verify video download and image download flows.
- Verify packaging through `pnpm run pack`.
- Define signing and notarization process before public release.
