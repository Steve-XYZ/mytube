# Repository guidance for Agents

## Project overview
MyTube is a cross-platform desktop application (macOS + Windows) that integrates a full web browser with advanced media downloading capabilities. It allows users to browse the web (YouTube, Google, etc.) and download videos or images directly via a dedicated manager. The architecture separates the App Shell (React), the Browser Tabs (WebContentsView), and the system-level controllers (yt-dlp, ffmpeg) into distinct processes.

> **NOTE: Package Manager Migration**
> The project currently uses `npm`, but we are migrating to **pnpm** for all future development. Please prioritize `pnpm` commands for all new tasks, installations, and scripts.

## Build and test
- Install dependencies: `pnpm install` (or `npm install` if pnpm is not yet configured)
- Build project: `pnpm run build`
- Run tests: `pnpm run test` (Vitest)
- Lint & Format check: `pnpm run lint`
- Preview (Renderer): `pnpm run dev`
- Electron Main Process: `pnpm run electron:dev`

## Engineering conventions
- **Process Separation**: Keep system-level logic (file system, child processes like yt-dlp/ffmpeg) strictly in the Main process.
- **IPC Communication**: All communication between the Renderer (React) and Main process must go through the `contextBridge` and defined IPC handlers.
- **Security First**: Never expose Node.js APIs to the Renderer. Ensure `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` are maintained.
- **Asynchronous I/O**: Use async/await for all heavy operations (downloads, file reading, media detection) to prevent blocking the main thread.
- **UI Components**: Use React functional components with hooks. Keep the UI logic for the Download Manager and Tab Bar decoupled from the core download engine.
- **Error Handling**: Implement a unified error handling strategy where backend errors (e.g., yt-dlp failures) are caught and mapped to user-friendly UI notifications.

## Data access & Persistence
- **Preferences**: Use `electron-store` for user settings. Do not store sensitive credentials in plain text.
- **Download Queue**: Use `better-sqlite3` for persistent tracking of the download queue to ensure recovery after app restarts.
- **File System**: All file operations must be handled by the Main process. Use absolute paths resolved via `app.getPath`.
- **Schema**: Any changes to the SQLite schema for the download queue must be accompanied by a migration strategy.

## Tests
- Add or update Vitest unit tests for core logic (`DownloadQueue`, `YtDlpController`, `MediaDetector`).
- Implement integration tests for the IPC bridge to ensure seamless communication between processes.
- Use Playwright or Spectron for E2E testing of the navigation and tab switching flow.
- Do not delete failing tests unless the feature is explicitly deprecated and documented.

## Pull request expectations
Before considering work complete:
- All relevant tests pass; any known issues are documented in the PR description.
- The diff is reviewed for security regressions (especially regarding WebContentsView permissions).
- Performance impact (memory leaks in tabs, CPU usage during ffmpeg merges) is considered.
- The final answer includes a concise PR summary including:
    - Features added/changed.
    - Impact on existing functionality.
    - Any new dependencies or environment variables required.

