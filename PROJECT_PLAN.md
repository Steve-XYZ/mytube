# MyTube Project Plan

## Objective

Build MyTube into a reliable cross-platform desktop browser with first-class media download workflows for macOS and Windows.

The target product should let a user:

- Browse the web in sandboxed Chromium tabs.
- Detect downloadable media on supported pages.
- Download videos/audio through packaged `yt-dlp` and `ffmpeg`.
- Detect and download page images.
- Manage downloads through a persistent queue.
- Configure browser/download preferences.
- Install and run the app from signed distributable builds.

## Current State

Branch: `analizar-estado-proyecto`

Current PR: https://github.com/Steve-XYZ/mytube/pull/1

The project is in stabilization. The app shell, browser tab system, preload bridge, download managers, settings UI, and unit tests exist. Local validation is healthy, but media binary setup, packaging, CI, end-to-end testing, and release hardening still need work.

### Confirmed Working

- `pnpm install` works after fixing pnpm build-script approval.
- Electron installs correctly and reports `v40.4.1`.
- `pnpm run dev:electron` starts Vite and Electron.
- App creates the first browser tab and loads Google.
- React renderer shell builds.
- Main/preload/renderer TypeScript builds pass through `pnpm run build:all`.
- Unit tests pass: 200 tests across 7 files.
- Lint passes with no production `any` warnings.
- Prettier check passes.
- Corrupted `downloads.json` is backed up and reset instead of repeatedly breaking launch.
- App-shell CSP is scoped to the shell WebContents so it does not break external browser tabs.

### Known Limitations

- `pnpm run setup` still depends on external binary downloads. The script starts correctly and is safer now, but the GitHub `yt-dlp` download was too slow and failed/cut during local attempts.
- `bin/` is ignored and currently empty in this workspace.
- Video/audio download flows cannot be fully validated until `yt-dlp`, `ffmpeg`, and `ffprobe` are present.
- Packaging has not been verified end-to-end.
- No GitHub Actions CI exists yet.
- No E2E coverage exists for browser navigation, tabs, download flows, or packaging smoke tests.
- Persistence is JSON-backed for now, not SQLite.
- Release signing/notarization is not configured.

## Validation Baseline

These commands should remain green before merging meaningful changes:

```bash
pnpm install
pnpm run test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build:all
pnpm run dev:electron
```

`pnpm run setup` is required for media download validation, but it is currently blocked by unreliable external downloads in this environment.

## Work Remaining

### 1. Stabilize Binary Setup

Goal: make `pnpm run setup` reliably populate `bin/` on supported platforms.

Tasks:

- Add resumable downloads for `yt-dlp` and ffmpeg archives, or switch to a more reliable source strategy.
- Validate file size/checksum before moving any downloaded binary into place.
- Print actionable errors when a provider fails.
- Support already-installed local binaries as a fallback (`yt-dlp`, `ffmpeg`, `ffprobe` from PATH).
- Verify setup on macOS arm64.
- Verify setup on macOS x64.
- Verify setup on Windows x64.
- Document manual binary placement for offline/dev fallback.

Acceptance:

- `pnpm run setup` completes from a clean checkout.
- `bin/yt-dlp`, `bin/ffmpeg`, and `bin/ffprobe` exist and are executable where applicable.
- `yt-dlp --version` and `ffmpeg -version` pass through the app-resolved paths.

### 2. Validate Core Browser Experience

Goal: prove that MyTube works as a browser before validating downloads.

Tasks:

- Smoke test app launch in dev and production-style start.
- Verify new tab, close tab, switch tab, and keyboard shortcuts.
- Verify navigation controls: back, forward, reload, stop.
- Verify URL/search parsing for normal URLs and search terms.
- Verify context menu actions on links, images, editable fields, and selected text.
- Verify find-in-page.
- Verify zoom controls.
- Verify renderer shell does not expose Node APIs.
- Verify external web pages are not affected by app-shell CSP.

Acceptance:

- Browser flows work manually on macOS.
- Browser flows have automated E2E coverage for the main happy paths.

### 3. Validate Video and Audio Downloads

Goal: prove video/audio download workflows work with packaged binaries.

Tasks:

- Verify `YtDlpController.getVideoInfo` against known public test URLs.
- Verify format listing and simplified format presets.
- Verify best-quality MP4 download.
- Verify audio-only download.
- Verify progress parsing, completion, failure, cancellation, pause, and resume behavior.
- Verify output path generation and unique filenames.
- Verify download queue persistence across restart.
- Verify missing-binary UI/error path is user-friendly.
- Verify logs do not leak excessive provider output into UI.

Acceptance:

- A user can download a supported public video.
- A user can download audio-only from a supported public video.
- Failed/unsupported URLs produce clear errors.
- Queue state survives restart without corrupting app launch.

### 4. Validate Image Detection and Downloads

Goal: make page image scanning/downloads dependable.

Tasks:

- Verify `<img>` scanning on normal pages.
- Verify CSS background image detection.
- Verify `<picture>`/`srcset` behavior.
- Validate filtering for tiny/tracking pixels.
- Verify single-image download.
- Verify batch download with progress.
- Verify referer handling for sites that require it.
- Add tests for URL filtering and gallery state behavior.

Acceptance:

- A user can scan a page and download selected images.
- Batch progress is visible and does not hang.
- Invalid image URLs fail cleanly.

### 5. Improve Persistence

Goal: decide and implement the right persistence layer for the download queue and settings.

Current state:

- Settings are stored in JSON.
- Download state is stored in JSON.
- Corrupt settings/download files are backed up.

Options:

- Keep JSON for v1 if the data model remains small.
- Move download queue to SQLite if pause/resume/history/querying becomes more complex.

Tasks:

- Define download queue schema and retention rules.
- Decide whether SQLite is required before v1.
- If SQLite is used, add migrations and tests.
- Add atomic writes for JSON files if JSON remains.
- Add backup/restore docs.

Acceptance:

- Restart recovery is reliable.
- Corrupt local state cannot prevent app launch.
- Persistence strategy is documented.

### 6. Add CI

Goal: prevent regressions from merging.

Tasks:

- Add GitHub Actions workflow for pull requests.
- Run `pnpm install`.
- Run `pnpm run test`.
- Run `pnpm run typecheck`.
- Run `pnpm run lint`.
- Run `pnpm run format:check`.
- Run `pnpm run build:all`.
- Add optional packaging smoke jobs for macOS and Windows.
- Cache pnpm store safely.

Acceptance:

- PRs show required green checks before merge.
- CI uses the same commands as local validation.

### 7. Add E2E and Smoke Testing

Goal: cover behavior that unit tests cannot prove.

Tasks:

- Choose Playwright-based Electron test approach.
- Add app launch test.
- Add navigation/tab test.
- Add settings modal test.
- Add image gallery smoke test.
- Add download flow smoke test with mocked `yt-dlp`/`ffmpeg` binaries.
- Add production build launch smoke test.

Acceptance:

- Main app workflows are tested without relying on live YouTube/network behavior.
- CI can run a meaningful smoke suite.

### 8. Packaging and Distribution

Goal: produce installable builds for macOS and Windows.

Tasks:

- Verify `pnpm run pack` on macOS.
- Verify `pnpm run dist:mac`.
- Verify `pnpm run dist:win` on Windows.
- Ensure `extraResources` includes binaries correctly.
- Ensure `build/icon.ico` exists for Windows or update config.
- Verify app starts from packaged build.
- Verify binary resolution in packaged build.
- Verify auto-updater behavior or disable until configured.
- Define release channel strategy.

Acceptance:

- macOS package launches and can browse.
- Windows package launches and can browse.
- Packaged app resolves media binaries from `resources/bin`.

### 9. Signing, Notarization, and Release Security

Goal: prepare public distribution.

Tasks:

- Define Apple Developer certificate requirements.
- Configure macOS code signing.
- Configure macOS notarization.
- Configure Windows signing strategy.
- Review entitlements.
- Review Electron security checklist.
- Validate no renderer Node access.
- Validate permission handling for web contents.
- Define update signing/release process.

Acceptance:

- macOS release is signed and notarized.
- Windows release is signed or the limitation is explicitly documented.
- Security posture is documented before public distribution.

### 10. Product and UX Hardening

Goal: make the app understandable and resilient for normal users.

Tasks:

- Add first-run guidance/disclaimer for responsible downloads.
- Add missing-binaries state in UI with setup instructions.
- Add clearer unsupported URL errors.
- Add download completion/failure notifications review.
- Add empty/error states for settings, downloads, and image gallery.
- Validate layout on small windows.
- Review keyboard shortcuts and menu labels.
- Add accessible labels/titles where needed.

Acceptance:

- A new user can understand what works and what is missing.
- Common failures have clear recovery paths.

## Suggested Milestones

### Milestone 1: Merge Stabilization PR

Scope:

- Merge PR #1 after review.
- Keep docs honest.
- Keep local validation green.

Exit criteria:

- PR #1 approved and merged.
- `master` passes local baseline commands.

### Milestone 2: Binary Setup and Media Smoke

Scope:

- Make `pnpm run setup` reliable.
- Populate `bin/`.
- Prove one video download and one audio download.

Exit criteria:

- Setup completes from clean checkout.
- Media download smoke test passes on macOS.

### Milestone 3: Browser and Download E2E

Scope:

- Add automated launch/navigation tests.
- Add mocked download E2E tests.

Exit criteria:

- CI or local E2E can prove app launch, tabs, navigation, and a download flow.

### Milestone 4: Packaging

Scope:

- Verify macOS and Windows packaging.
- Verify packaged binary resolution.

Exit criteria:

- Installable builds launch and basic flows work.

### Milestone 5: Release Candidate

Scope:

- Signing/notarization.
- UX hardening.
- Final security review.
- Release notes.

Exit criteria:

- Signed release candidate is usable by non-developer testers.

## Immediate Next Actions

1. Finish review/merge of PR #1.
2. Fix binary setup reliability or add a deterministic local-binary fallback.
3. Add CI for the current validation baseline.
4. Add first Electron E2E smoke test.
5. Validate packaged app launch with `pnpm run pack`.

## Current Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| External binary downloads are unreliable | Blocks media download validation | Add retries, resume support, checksum validation, and PATH/manual fallback |
| Packaged binary resolution unverified | Downloads may work in dev but fail in release | Add packaged smoke test |
| No CI | Regressions can merge unnoticed | Add PR workflow before larger feature work |
| Live media sites change behavior | Tests can become flaky | Use mocked binaries for CI and live smoke tests only manually |
| JSON persistence may not scale | Download queue could become brittle | Decide JSON vs SQLite before heavy queue features |
| Signing/notarization not configured | Public release blocked | Plan certificates and release process early |

## Definition of Done for V1

MyTube can be considered V1-ready when:

- Clean install works on macOS and Windows.
- App launches from packaged builds.
- Browser tab/navigation workflows are stable.
- `yt-dlp`, `ffmpeg`, and `ffprobe` are resolved in dev and packaged builds.
- Video/audio download happy paths work.
- Image scanning/download happy paths work.
- Settings and download queue survive restart.
- CI validates tests, typecheck, lint, format, and build.
- E2E smoke tests cover launch/navigation/download basics.
- Release signing/notarization strategy is complete or explicitly documented for internal-only distribution.
