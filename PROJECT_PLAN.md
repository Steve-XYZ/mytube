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

Branch: `master`

Latest stabilization merge: https://github.com/Steve-XYZ/mytube/pull/1

The project is in post-stabilization pre-release. The app shell, browser tab system, preload bridge, download managers, settings UI, and unit tests exist. Local validation is healthy, media binaries can be installed through `pnpm run setup`, and representative video/image download flows have been smoke-tested. PR CI exists for the static/unit gates, while end-to-end testing, release verification, signing, and broader product polish still need work.

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
- Action panels render above browser tabs and stay clickable.
- Image gallery detects page images, reports batch progress, saves images, and can reveal files in Finder.
- `pnpm run setup` installs/copies `yt-dlp`, `ffmpeg`, `ffprobe`, and the optional YouTube PO-token provider.
- `yt-dlp` uses Node JS runtime detection, resilient socket/retry flags, selected format persistence, and public YouTube extraction without relying on Google login inside Electron.
- Video metadata requests are deduplicated per URL and cached briefly.
- Video metadata extraction no longer has a 30-second hard timeout; it uses a 10-minute maximum and a 2-minute no-output stall guard.
- Public YouTube download smoke tests pass with the local PO-token provider.
- Image download smoke testing saved files under `~/Downloads/MyTube/Images`.

### Known Limitations

- `pnpm run setup` depends on external binary/provider downloads and npm install for the PO-token provider.
- `bin/` is ignored by git and must be populated per checkout.
- The PO-token provider is an external component pinned to `bgutil-ytdlp-pot-provider` `1.3.1` commit `7608dd51ee813b48cf9a6d68c6e42cb197ce10e0`; its dependency tree needs production security review.
- YouTube can still reject anonymous guest sessions for specific videos/networks before formats are returned, even with PO-token support.
- Packaging has not been verified end-to-end.
- GitHub Actions PR CI covers tests, typecheck, lint, format, build, and the Playwright E2E smoke suite.
- Playwright E2E covers launch, tabs, navigation, settings persistence, mocked download flows, the image gallery, and a packaged-build smoke (mock binaries); find-in-page and real-binary packaged validation are still missing.
- Persistence is JSON-backed for now, not SQLite.
- Release signing/notarization configuration is in place; actual signing still requires external certificates and notarization credentials.

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

Run this before validating media flows on a fresh checkout:

```bash
pnpm run setup
```

Recent local smoke evidence:

- Public YouTube download through `yt-dlp` + PO-token provider produced an MP4.
- A 44:34 YouTube video returned metadata and 40 formats without the previous app timeout.
- Image download flow saved detected page images and reported results in the UI.

## Work Remaining

### 1. Stabilize Binary Setup

Goal: make `pnpm run setup` reproducible and auditable on supported platforms.

Tasks:

- Add checksum validation for downloaded binaries and provider artifacts.
- Print actionable errors when a provider fails.
- Support already-installed local binaries as a fallback (`yt-dlp`, `ffmpeg`, `ffprobe` from PATH).
- Verify setup on macOS arm64.
- Verify setup on macOS x64.
- Verify setup on Windows x64.
- Document manual binary placement for offline/dev fallback.
- Audit the PO-token provider dependency tree before production packaging.

Acceptance:

- `pnpm run setup` completes from a clean checkout.
- `bin/yt-dlp`, `bin/ffmpeg`, `bin/ffprobe`, and the optional PO-token provider exist where applicable.
- `yt-dlp --version` and `ffmpeg -version` pass through the app-resolved paths.
- Setup failures leave no partial executable artifacts behind.

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
- Verify large-file behavior with long videos and slow downloads.
- Add explicit test coverage for metadata request deduplication and timeout policy.

Acceptance:

- A user can download a supported public video.
- A user can download audio-only from a supported public video.
- Failed/unsupported URLs produce clear errors.
- Queue state survives restart without corrupting app launch.
- Long videos do not fail due to an app-level short timeout.

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

### 6. Maintain CI

Goal: prevent regressions from merging and keep release packaging separate from fast PR validation.

Tasks:

- Keep the pull request workflow running `pnpm install --frozen-lockfile`.
- Keep `pnpm run test`.
- Keep `pnpm run typecheck`.
- Keep `pnpm run lint`.
- Keep `pnpm run format:check`.
- Keep `pnpm run build:all`.
- Add optional packaging smoke jobs for macOS and Windows.
- Cache pnpm store safely.

Acceptance:

- PRs show required green checks before merge.
- CI uses the same commands as local validation.

### 7. Add E2E and Smoke Testing

Goal: cover behavior that unit tests cannot prove.

Tasks:

- Choose Playwright-based Electron test approach. (done — `_electron.launch` against the built app; every `WebContentsView` is visible as a Playwright `Page`)
- Add app launch test. (done — includes renderer shell render and no-Node-APIs security check)
- Add navigation/tab test. (done — local HTTP server, URL bar, back/forward, tab create/switch/close)
- Add settings modal test. (done — theme change applies live and persists across an app restart)
- Add image gallery smoke test. (done — locally served PNGs, tiny-image filtering, batch download to the isolated downloads dir, empty state)
- Add download flow smoke test with mocked `yt-dlp`/`ffmpeg` binaries. (done — mock binary via `MYTUBE_BIN_DIR`; covers metadata, video, audio-only, and failure surfacing)
- Add production build launch smoke test. (done — `pnpm run test:e2e:packaged` stages mock binaries, packs with `electron-builder --dir`, launches the packaged executable, and completes a download resolved from `resources/bin`)

Test-support hooks: `MYTUBE_USER_DATA_DIR` isolates persisted state (including the system downloads path) per test run, and `MYTUBE_BIN_DIR` redirects media binary resolution to `tests/e2e/fixtures/bin`.

Acceptance:

- Main app workflows are tested without relying on live YouTube/network behavior.
- CI can run a meaningful smoke suite.

Status: complete. 16 tests run in PR CI under xvfb: 13 dev-mode plus a packaged-build job that verifies launch and packaged binary resolution.

### 8. Packaging and Distribution

Goal: produce installable builds for macOS and Windows.

Tasks:

- Verify `pnpm run pack` on macOS.
- Verify `pnpm run dist:mac`.
- Verify `pnpm run dist:win` on Windows.
- Ensure `extraResources` includes binaries correctly.
- Ensure `build/icon.ico` exists for Windows or update config.
- Verify app starts from packaged build. (automated for `--dir` packs: `pnpm run test:e2e:packaged`, verified on macOS arm64 and Linux x64 CI)
- Verify binary resolution in packaged build. (automated with mock binaries — the packaged smoke completes a download resolved from `resources/bin`; real-binary validation still manual)
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
- Provide macOS code signing credentials through `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD`.
- Provide macOS notarization credentials through Apple ID, App Store Connect API key, or keychain profile secrets.
- Provide Windows signing credentials through `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.
- Review entitlements.
- Review Electron security checklist.
- Validate no renderer Node access.
- Validate permission handling for web contents.
- Keep `pnpm run release:check` passing before release builds.

Acceptance:

- macOS release is signed and notarized when credentials are configured.
- Windows release is signed when credentials are configured, or the unsigned limitation is explicitly documented.
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

- Merge PR #1 after local validation.
- Keep docs honest.
- Keep local validation green.

Exit criteria:

- PR #1 merged to `master`.
- `master` passes local baseline commands.

Status: complete.

### Milestone 2: Binary Setup and Media Smoke

Scope:

- Make `pnpm run setup` reliable.
- Populate `bin/`.
- Prove one video download and one audio download.
- Prove one image batch download.

Exit criteria:

- Setup completes from clean checkout.
- Media download smoke test passes on macOS.

Status: partially complete on the current macOS workspace. Windows and clean-machine verification remain.

### Milestone 3: Browser and Download E2E

Scope:

- Add automated launch/navigation tests.
- Add mocked download E2E tests.

Exit criteria:

- CI or local E2E can prove app launch, tabs, navigation, and a download flow.

Status: complete. PR CI runs the Playwright suite covering launch, tabs, navigation, settings, and mocked download flows.

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

1. Add a runtime yt-dlp updater so installed apps keep working when YouTube changes (build-time freshness is not enough for end users).
2. Verify `pnpm run setup` on a clean macOS arm64 checkout and document any manual fallback.
3. Verify `pnpm run setup` and installer packaging on Windows x64.
4. Validate packaged app launch with `pnpm run pack`.
5. Audit the PO-token provider and define the production packaging/security stance.
6. Keep `docs/supported-platforms.md` aligned with URL classifier support and QA evidence.

## Current Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| External binary/provider downloads are unreliable | Blocks media setup on clean machines | Keep partial-download safety, add checksum validation, and document PATH/manual fallback |
| External PO-token provider has its own dependency tree | Supply-chain/security risk for production builds | Pin commits, audit dependencies, and decide whether to bundle, install on setup, or make optional |
| YouTube can reject anonymous guest sessions | Some public videos still cannot be extracted | Surface clear errors, avoid embedded Google login, and consider browser-captured signed media URLs as a future fallback |
| Packaged binary resolution unverified | Downloads may work in dev but fail in release | Add packaged smoke test |
| Packaged smoke uses mock media binaries | Real yt-dlp/ffmpeg behavior in packages is still unproven | Run `pnpm run test:e2e:packaged` after `pnpm run setup:bins` for release validation (download smoke auto-skips with real binaries) |
| Live media sites change behavior | Tests can become flaky | Use mocked binaries for CI and live smoke tests only manually |
| JSON persistence may not scale | Download queue could become brittle | Decide JSON vs SQLite before heavy queue features |
| Signing/notarization credentials are external | Public release requires private credentials | Keep hooks configured and fail strict checks with `MYTUBE_REQUIRE_SIGNING=1` |

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
- Platform claims match `docs/supported-platforms.md`.
