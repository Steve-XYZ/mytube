# MyTube - Tracking de Progreso

## Estado General

| Fase | Descripción | Estado | Progreso |
|------|-------------|--------|----------|
| 1 | Fundación y Configuración | Completada | 100% |
| 2 | Navegador Web Integrado | Completada | 100% |
| 3 | Motor de Descarga de Videos | Completada | 100% |
| 4 | Descarga de Imágenes | Completada | 100% |
| 5 | Configuración y Preferencias | Completada | 100% |
| 6 | Detección Inteligente de Media | Completada | 100% |
| 7 | Pulido y UX | Completada | 100% |
| 8 | Seguridad y Rendimiento | Completada | 100% |
| 9 | Empaquetado y Distribución | Completada | 100% |
| 10 | Pre-producción y Launch | Completada | 100% |

---

## FASE 1: Fundación y Configuración

### 1.1 Inicialización del Proyecto
- [x] Inicializar proyecto con `pnpm init`
- [x] Configurar TypeScript (`tsconfig.json` + project references)
- [x] Configurar Electron + Vite + React
- [ ] Configurar ESLint + Prettier _(diferido, no bloqueante)_
- [x] Crear estructura de directorios

### 1.2 Configuración de Electron Base
- [x] Crear `MainWindow` con `BaseWindow` + `WebContentsView`
- [x] Configurar `preload` scripts con `contextBridge`
- [x] Implementar IPC bridge básico (main <-> renderer)
- [x] Configurar seguridad: sandbox, contextIsolation, nodeIntegration
- [x] Configurar Content Security Policy

### 1.3 Configuración de Build
- [x] Configurar `electron-builder.yml` para macOS y Windows
- [x] Configurar `extraResources` para yt-dlp y ffmpeg
- [ ] Script para descargar binarios por plataforma _(se hará en Fase 3)_
- [x] Verificar build funcional en dev mode
- [x] Verificar build funcional en production mode

---

## FASE 2: Navegador Web Integrado

### 2.1 Sistema de Tabs Mejorado
- [x] Tab lifecycle con eventos completos (loading, navigate, title, favicon)
- [x] Manejo de nuevas ventanas / popups (open in new tab)
- [x] Tab switching desde main process (keyboard shortcuts)
- [x] Next/Previous tab navigation con wrap-around
- [x] Switch to tab by index (Cmd+1 through Cmd+9)

### 2.2 Context Menu
- [x] Click derecho en link: Open in New Tab, Copy Link Address
- [x] Click derecho en imagen: Open in New Tab, Save Image As, Copy Image Address
- [x] Selección de texto: Copy, Search Google
- [x] Campos editables: Cut, Copy, Paste, Select All
- [x] Página vacía: Back, Forward, Reload
- [x] Siempre disponible: Inspect Element

### 2.3 Keyboard Shortcuts
- [x] `Cmd+T` — Nueva tab
- [x] `Cmd+W` — Cerrar tab
- [x] `Cmd+L` — Focus URL bar
- [x] `Cmd+F` — Toggle Find in Page
- [x] `Cmd+R` — Reload
- [x] `Cmd+Tab` / `Cmd+Shift+Tab` — Cambiar tabs
- [x] `Cmd+1-9` — Ir a tab N (Cmd+9 = última)
- [x] `Cmd++` / `Cmd+-` / `Cmd+0` — Zoom in/out/reset
- [x] `Cmd+[` / `Cmd+]` — Back / Forward
- [x] `Escape` — Cerrar Find bar

### 2.4 Find In Page
- [x] FindBar component con input, resultados, next/prev/close
- [x] Búsqueda en tiempo real mientras se escribe
- [x] Indicador de matches (N / M)
- [x] Enter = next, Shift+Enter = previous
- [x] Escape cierra el find bar

### 2.5 Zoom
- [x] Zoom in/out/reset via keyboard shortcuts
- [x] Indicador de zoom en la barra de navegación
- [x] Click en indicador de zoom para resetear

### 2.6 New Tab Page
- [x] Componente NewTabPage con logo y búsqueda
- [x] Quick links: YouTube, Google, Twitter, Reddit, Instagram, TikTok, Vimeo, GitHub
- [x] Autofocus en campo de búsqueda
- [x] Soporte dark/light mode

### 2.7 Navegación
- [x] Detección inteligente URL vs búsqueda (espacios, puntos)
- [x] Auto-prepend https://
- [x] Indicador de seguridad (lock icon para HTTPS)
- [x] URL bar con select-all on focus

### 2.8 Seguridad Browser
- [x] Permission handler (solo clipboard y fullscreen)
- [x] Certificate error handling
- [x] did-fail-load logging

### Archivos nuevos/modificados
- `src/main/window/TabManager.ts` — Reescrito: zoom, find, context menu, permissions
- `src/main/window/KeyboardShortcuts.ts` — **Nuevo**: manejo de atajos de teclado
- `src/renderer/components/FindBar/` — **Nuevo**: Find in Page UI
- `src/renderer/components/NewTabPage/` — **Nuevo**: New Tab page
- `src/renderer/components/NavigationBar/` — Actualizado: zoom indicator, ref para focus
- `src/renderer/hooks/useTabs.ts` — Actualizado: sync con tabs creadas desde main
- `src/renderer/App.tsx` — Actualizado: integra FindBar, shortcut events
- `src/preload/index.ts` — Actualizado: zoom, find, shortcut APIs
- `src/shared/types.ts` — Actualizado: isSecure, zoomLevel, find/zoom IPC channels

---

## FASE 3: Motor de Descarga de Videos

### 3.1 Binarios
- [x] Script `scripts/download-binaries.sh` para descargar yt-dlp y ffmpeg
- [x] yt-dlp standalone binary (sin Python) — v2026.02.04
- [x] ffmpeg v7.0 para macOS arm64
- [x] Soporte multiplataforma (macOS/Linux/Windows) en el script
- [x] Resolución dinámica de rutas: dev (`bin/`) vs production (`resources/bin/`)

### 3.2 YtDlpController
- [x] `getVideoInfo(url)` — ejecuta `--dump-json`, retorna metadata completa
- [x] `getSimplifiedFormats(url)` — formatos resumidos por resolución
- [x] `download(id, url, options, onProgress, onComplete, onError)` — descarga con tracking
- [x] Parsing de progreso: porcentaje, velocidad, ETA, tamaño total
- [x] Detección de filename desde stdout (Destination, Merger, already downloaded)
- [x] `cancel(id)` / `cancelAll()` — cancelar descargas en curso
- [x] Timeout de 30s para queries de info
- [x] `--ffmpeg-location` configurado al ffmpeg empaquetado
- [x] Formato por defecto: best video+audio merged en MP4
- [x] Soporte audio-only (MP3)

### 3.3 DownloadManager
- [x] Cola de descargas con límite concurrente (default: 3)
- [x] Estados: queued → downloading → completed/failed/paused
- [x] Pause/Resume/Cancel por descarga individual
- [x] Persistencia de estado en disco (`downloads.json` en userData)
- [x] Recuperación de descargas al reiniciar la app
- [x] IPC handlers para todas las operaciones
- [x] `openFile` / `showInFolder` / `removeDownload` / `clearCompleted`
- [x] Auto-creación del directorio `~/Downloads/MyTube/`
- [x] Fetch automático de título y thumbnail del video

### 3.4 FormatSelector UI
- [x] Diálogo modal con overlay
- [x] Muestra thumbnail, título, duración, uploader
- [x] Lista de formatos por resolución (1080p, 720p, etc.)
- [x] Presets: "Best Quality (MP4)" y "Audio Only (MP3)"
- [x] Loading spinner mientras fetcha info
- [x] Manejo de errores (URL no soportada)

### 3.5 DownloadPanel UI
- [x] Panel lateral slide-out (360px)
- [x] Lista de descargas con progreso en tiempo real
- [x] Barra de progreso animada
- [x] Indicadores: porcentaje, velocidad, ETA
- [x] Acciones: pausar, reanudar, cancelar, abrir archivo, mostrar en carpeta
- [x] Badge con conteo de descargas activas
- [x] Botón "Clear" para limpiar completadas
- [x] Estado vacío con hint

### 3.6 Integración con NavigationBar
- [x] Botón de descarga que se ilumina en páginas de video
- [x] Detección automática de YouTube, Vimeo, Twitter, TikTok, Instagram, Reddit, etc.
- [x] Click en video page → abre FormatSelector
- [x] Botón separado para toggle del DownloadPanel

### Archivos nuevos/modificados
- `scripts/download-binaries.sh` — **Nuevo**: descarga yt-dlp y ffmpeg
- `bin/yt-dlp`, `bin/ffmpeg`, `bin/ffprobe` — Binarios descargados
- `src/main/download/YtDlpController.ts` — **Nuevo**: wrapper sobre yt-dlp
- `src/main/download/DownloadManager.ts` — **Nuevo**: cola de descargas con IPC
- `src/main/window/MainWindow.ts` — Actualizado: integra DownloadManager
- `src/renderer/components/FormatSelector/` — **Nuevo**: selector de formato modal
- `src/renderer/components/DownloadPanel/` — **Nuevo**: panel de descargas
- `src/renderer/components/NavigationBar/` — Actualizado: botones de descarga
- `src/renderer/App.tsx` — Actualizado: integra FormatSelector + DownloadPanel
- `src/preload/index.ts` — Actualizado: APIs de descarga adicionales

## FASE 4: Descarga de Imágenes

### 4.1 ImageDownloader Service
- [x] HTTP/HTTPS download con manejo de redirects
- [x] Descarga en batch (5 concurrentes)
- [x] Generación de filenames únicos y sanitización
- [x] Soporte para header Referer
- [x] Directorio por defecto: `~/Downloads/MyTube/Images/`

### 4.2 MediaDetector
- [x] Escaneo de imágenes en la página activa via JavaScript injection
- [x] Detección de `<img>`, CSS background-image, `<picture><source>`
- [x] Filtrado de imágenes pequeñas (<50px), tracking pixels, spacers
- [x] Ordenamiento por tamaño (más grandes primero)
- [x] IPC handlers: `media:scan-images`, `media:download-image`, `media:download-images-batch`

### 4.3 ImageGallery UI
- [x] Modal overlay con grid de imágenes detectadas
- [x] Checkboxes para selección individual y múltiple
- [x] Select All / Deselect All
- [x] Descarga batch con indicador de progreso
- [x] Botón de descarga individual por imagen
- [x] Muestra resolución de cada imagen
- [x] Loading spinner durante escaneo
- [x] Estado vacío cuando no hay imágenes

### 4.4 Integración
- [x] Botón de imagen en NavigationBar (icono de paisaje)
- [x] MediaDetector integrado en MainWindow
- [x] Preload actualizado con APIs de imagen
- [x] `webContentsId` añadido a TabInfo para identificar tabs
- [x] Escape cierra la galería de imágenes
- [x] Compilación exitosa de los tres targets

### Archivos nuevos/modificados
- `src/main/download/ImageDownloader.ts` — **Nuevo**: servicio de descarga HTTP de imágenes
- `src/main/media/MediaDetector.ts` — **Nuevo**: escaneo de páginas para detectar imágenes
- `src/renderer/components/ImageGallery/` — **Nuevo**: galería modal de imágenes
- `src/main/window/MainWindow.ts` — Actualizado: integra MediaDetector
- `src/preload/index.ts` — Actualizado: APIs de imagen + fix return types
- `src/shared/types.ts` — Actualizado: `webContentsId` en TabInfo
- `src/renderer/App.tsx` — Actualizado: integra ImageGallery
- `src/renderer/components/NavigationBar/` — Actualizado: botón de galería de imágenes

## FASE 5: Configuración y Preferencias

### 5.1 SettingsManager Service
- [x] Persistencia JSON en `userData/settings.json`
- [x] Deep merge con defaults para manejar settings nuevos en updates
- [x] IPC handlers para get/set/getAll
- [x] Selector de directorio via `dialog.showOpenDialog`
- [x] Aplicación de tema via `nativeTheme.themeSource`
- [x] Start on boot via `app.setLoginItemSettings`
- [x] Sistema de listeners para cambios internos (DownloadManager, TabManager)
- [x] Notificación al renderer via `settings:changed`

### 5.2 Settings UI
- [x] Modal con navegación lateral (General, Downloads, Browser)
- [x] General: selector de tema (System/Light/Dark), idioma (EN/ES), toggle start on boot
- [x] Downloads: directorio, calidad de video, formato video/audio, max concurrent
- [x] Browser: homepage, motor de búsqueda (Google/DuckDuckGo/Bing)
- [x] Toggle switch custom para booleans
- [x] Select dropdowns con diseño nativo
- [x] Estilos consistentes con el resto de la app

### 5.3 Integración
- [x] SettingsManager integrado en MainWindow como primer manager
- [x] TabManager usa search engine setting (Google/DuckDuckGo/Bing)
- [x] DownloadManager usa directorio y maxConcurrent del settings
- [x] DownloadManager reacciona a cambios en settings en tiempo real
- [x] Tema CSS soporta `data-theme` attribute para forced light/dark
- [x] Renderer aplica tema al cargar y escucha cambios
- [x] Botón de settings (engranaje) en NavigationBar
- [x] Escape cierra el panel de settings
- [x] Compilación exitosa de los tres targets

### Archivos nuevos/modificados
- `src/main/settings/SettingsManager.ts` — **Nuevo**: servicio de persistencia de settings
- `src/renderer/components/Settings/Settings.tsx` — **Nuevo**: panel de configuración UI
- `src/renderer/components/Settings/Settings.css` — **Nuevo**: estilos del panel
- `src/main/window/MainWindow.ts` — Actualizado: integra SettingsManager
- `src/main/window/TabManager.ts` — Actualizado: usa search engine setting
- `src/main/download/DownloadManager.ts` — Actualizado: usa download dir y maxConcurrent
- `src/renderer/styles/global.css` — Actualizado: soporte data-theme para forced theme
- `src/renderer/App.tsx` — Actualizado: integra Settings, aplica tema
- `src/renderer/components/NavigationBar/` — Actualizado: botón de settings
- `src/preload/index.ts` — Actualizado: evento settings:changed

### Decisiones
| Fecha | Decisión | Razón |
|-------|----------|-------|
| 2026-02-20 | JSON simple sobre electron-store | electron-store v11 es ESM-only, incompatible con CJS del main process |

## FASE 6: Detección Inteligente de Media

### 6.1 Detección en Dos Niveles
- [x] **Tier 1 (instantáneo):** Detección por patrón de URL al navegar (did-navigate, did-navigate-in-page)
- [x] **Tier 2 (autoritativo):** Probe asíncrono con yt-dlp para confirmar media descargable
- [x] Lista ampliada de plataformas: YouTube, Vimeo, Dailymotion, TikTok, Twitter/X, Instagram, Reddit, Facebook, Twitch, Rumble, Bilibili, Odysee, Bandcamp, SoundCloud
- [x] Cancelación de detecciones obsoletas cuando el usuario navega a otra página
- [x] Estado `mediaState` en TabInfo: `none` → `detecting` → `detected`/`unsupported`
- [x] Campo `mediaTitle` en TabInfo con el título detectado

### 6.2 Emisión de MEDIA_DETECTED
- [x] Canal `MEDIA_DETECTED` (ya definido en types) ahora emitido desde TabManager
- [x] Payload incluye tabId, url, title, thumbnail
- [x] Logging de detección exitosa

### 6.3 UI Reactiva
- [x] Eliminado `isVideoUrl()` del renderer — reemplazado por `mediaState` reactivo
- [x] Botón de descarga muestra spinner durante detección (state: `detecting`)
- [x] Botón se ilumina con acento cuando confirmado (state: `detected`)
- [x] Tooltip muestra título del media detectado
- [x] Botón no visible cuando no hay media (state: `none`/`unsupported`)
- [x] CSS para spinner de detección y estados de botón

### Archivos nuevos/modificados
- `src/shared/types.ts` — Actualizado: `MediaDetectionState` type, `mediaState` y `mediaTitle` en TabInfo
- `src/main/window/TabManager.ts` — Actualizado: detección 2-tier, YtDlpController integrado, `isKnownVideoUrl()`, `probeMediaAsync()`
- `src/renderer/App.tsx` — Actualizado: usa `mediaState` reactivo, elimina `isVideoUrl()`
- `src/renderer/components/NavigationBar/` — Actualizado: acepta `mediaState`, muestra spinner/highlight
- `src/renderer/components/NavigationBar/NavigationBar.css` — Actualizado: estilos detecting spinner

## FASE 7: Pulido y UX

### 7.1 Atajos de Teclado (ya completados en fases previas + nuevos)
- [x] `Cmd+T/W/L/F/R` — Tab/close/url/find/reload (Fase 2)
- [x] `Cmd+Tab/Shift+Tab` — Cambiar tabs (Fase 2)
- [x] `Cmd+1-9` — Ir a tab N (Fase 2)
- [x] `Cmd++/-/0` — Zoom (Fase 2)
- [x] `Cmd+[/]` — Back/Forward (Fase 2)
- [x] `Cmd+D` — **Nuevo**: Descargar media de la página actual
- [x] `Cmd+J` — **Nuevo**: Toggle panel de descargas

### 7.2 Notificaciones Nativas
- [x] Notificación del SO al completar descarga (título del video)
- [x] Click en notificación abre la carpeta del archivo
- [x] Badge en el dock de macOS con conteo de descargas activas
- [x] Badge se limpia cuando no hay descargas activas

### 7.3 Drag & Drop de Tabs
- [x] Tabs reordenables via HTML5 drag-and-drop
- [x] Indicador visual de posición de drop (borde azul)
- [x] Opacidad reducida para tab arrastrada
- [x] Reordenamiento solo visual (renderer-side)

### 7.4 Sistema de Toasts
- [x] Componente Toast con animaciones slide-in/out
- [x] Tipos: error (rojo), success (verde), info (azul)
- [x] Auto-dismiss después de 5 segundos
- [x] Dismiss manual con botón X
- [x] Toast al completar descarga
- [x] Toast al fallar descarga
- [x] Hook `useToasts()` reutilizable

### 7.5 Temas (ya completados en Fase 5)
- [x] Light, Dark, System (Fase 5)
- [x] CSS variables (Fase 1)

### Archivos nuevos/modificados
- `src/renderer/components/Toast/` — **Nuevo**: sistema de notificaciones in-app
- `src/renderer/components/TabBar/TabBar.tsx` — Actualizado: drag-and-drop reorder
- `src/renderer/components/TabBar/TabBar.css` — Actualizado: estilos drag
- `src/renderer/hooks/useTabs.ts` — Actualizado: `reorderTabs()`
- `src/main/window/KeyboardShortcuts.ts` — Actualizado: Cmd+D, Cmd+J
- `src/main/download/DownloadManager.ts` — Actualizado: notificaciones, dock badge
- `src/preload/index.ts` — Actualizado: `onDownloadMedia`, `onToggleDownloads`
- `src/renderer/App.tsx` — Actualizado: integra toasts, reorder, shortcuts

## FASE 8: Seguridad y Rendimiento

### 8.1 Seguridad — Validación de WebContents
- [x] MediaDetector valida `webContentsId` contra tabs registradas
- [x] TabManager registra/desregistra webContentsIds al crear/cerrar tabs
- [x] Rechaza scan requests de webContentsIds no autorizados

### 8.2 Seguridad — Validación de URLs
- [x] `isAllowedUrl()` en TabManager — solo permite `http:` y `https:`
- [x] `will-navigate` guard en tabs — bloquea navegación a protocolos no-http
- [x] `will-navigate` guard en `index.ts` (web-contents-created) — capa global

### 8.3 Seguridad — Path Traversal Prevention
- [x] ImageDownloader sanitiza filenames (elimina caracteres peligrosos)
- [x] Validación de path resuelto dentro del directorio de descargas
- [x] Límite de redirects HTTP (máximo 5)

### 8.4 Seguridad — CSP y Cleanup
- [x] CSP de producción estricto (sin `unsafe-eval`, sin `localhost`)
- [x] CSP relajado solo en desarrollo para Vite HMR
- [x] IPC handlers cleanup en `destroy()` de TabManager, DownloadManager, MediaDetector
- [x] Manejo de renderer crash (`render-process-gone`)
- [x] Detección de renderers no responsivos (`unresponsive`/`responsive`)

### 8.5 Rendimiento — Suspensión de Tabs
- [x] Auto-suspensión de tabs inactivas después de 10 minutos
- [x] Restauración automática al re-seleccionar tab suspendida
- [x] No suspende: tab activa, tabs ya suspendidas, tabs detectando media
- [x] Timer de verificación cada 60 segundos
- [x] Límite máximo de 20 tabs simultáneas
- [x] Compilación exitosa de los tres targets

### Archivos nuevos/modificados
- `src/main/index.ts` — Actualizado: will-navigate guard global, render-process-gone, unresponsive handlers
- `src/main/window/TabManager.ts` — Actualizado: isAllowedUrl, will-navigate en tabs, suspend/restore, tab limit, IPC cleanup
- `src/main/window/MainWindow.ts` — Actualizado: dev-only CSP override via onHeadersReceived
- `src/main/media/MediaDetector.ts` — Actualizado: allowedWebContentsIds validation, IPC cleanup
- `src/main/download/ImageDownloader.ts` — Actualizado: filename sanitization, path traversal check, redirect limit
- `src/main/download/DownloadManager.ts` — Actualizado: IPC cleanup en destroy()

## FASE 9: Empaquetado y Distribución

### 9.1 Configuración de electron-builder
- [x] `electron-builder.yml` completo con macOS (DMG + ZIP), Windows (NSIS + Portable), Linux (AppImage + deb)
- [x] ASAR packaging con compresión máxima
- [x] `extraResources` incluye yt-dlp, ffmpeg, ffprobe
- [x] DMG configurado con layout Applications link
- [x] NSIS con opción de cambiar directorio, shortcuts de escritorio y menú inicio

### 9.2 App Icons
- [x] Script `scripts/generate-icons.sh` para generar iconos desde PNG fuente
- [x] macOS `.icns` generado via `iconutil` (10 tamaños)
- [x] Linux PNGs (16-512px) en `build/icons/`
- [x] PNG fuente para auto-conversión a `.ico` por electron-builder
- [x] Placeholder icon con gradiente rojo-púrpura y play triangle

### 9.3 macOS Entitlements
- [x] `build/entitlements.mac.plist` con permisos necesarios
- [x] JIT, unsigned executable memory, network client
- [x] Acceso read-write a archivos seleccionados y carpeta Downloads
- [x] Hardened runtime habilitado
- [x] Ad-hoc signing (sin certificado de desarrollador)

### 9.4 Auto-Updater
- [x] `AutoUpdater` module con `electron-updater`
- [x] Eventos: checking, available, not-available, progress, downloaded, error
- [x] IPC handlers: `updater:check`, `updater:download`, `updater:install`
- [x] No descarga automáticamente (usuario decide)
- [x] Instala al cerrar la app si update descargado
- [x] Check automático 5s después de launch (solo producción)
- [x] Publish config: GitHub Releases

### 9.5 Build Scripts
- [x] `pnpm run pack` — empaqueta en directorio (sin installer)
- [x] `pnpm run dist` — genera instaladores para plataforma actual
- [x] `pnpm run dist:mac` — genera DMG + ZIP
- [x] `pnpm run dist:win` — genera NSIS + Portable

### 9.6 Verificación
- [x] Build exitoso: `MyTube.app` generado (387MB con binarios)
- [x] ASAR archive incluido correctamente
- [x] Binarios (yt-dlp, ffmpeg, ffprobe) en `Resources/bin/`
- [x] Compilación de todos los targets exitosa

### Archivos nuevos/modificados
- `electron-builder.yml` — Actualizado: Linux target, DMG layout, NSIS config, compression, entitlements
- `build/entitlements.mac.plist` — **Nuevo**: macOS entitlements
- `build/icon.icns` — **Nuevo**: macOS app icon
- `build/icon.png` — **Nuevo**: source icon para auto-conversión
- `build/icons/*.png` — **Nuevo**: Linux icons (16-512px)
- `scripts/generate-icons.sh` — **Nuevo**: generador de iconos multiplataforma
- `src/main/updater/AutoUpdater.ts` — **Nuevo**: auto-updater con IPC
- `src/main/window/MainWindow.ts` — Actualizado: integra AutoUpdater

## FASE 10: Pre-producción y Launch

### 10.1 App Menu Nativo
- [x] Menú completo: App (macOS), File, Edit, View, Window, Help
- [x] File: New Tab, Close Tab, Quit
- [x] Edit: Undo, Redo, Cut, Copy, Paste, Select All
- [x] View: Reload, Zoom In/Out/Reset, Downloads, Toggle DevTools
- [x] Window: Minimize, Zoom, Next/Previous Tab
- [x] Help: About MyTube, Report Issue
- [x] macOS: Settings (Cmd+,), Hide/Unhide

### 10.2 About Dialog
- [x] Muestra versión de la app, Electron, Chrome, Node.js
- [x] Descripción breve de la app
- [x] Accesible desde menú App (macOS) y Help

### 10.3 Error Page
- [x] Página de error user-friendly cuando falla la navegación
- [x] Mensajes amigables para errores comunes (DNS, timeout, conexión, certificado)
- [x] Botón "Try Again" para reintentar
- [x] Diseño responsive con soporte dark/light mode
- [x] No se muestra para ERR_ABORTED (navegación cancelada)

### 10.4 Loading Progress Bar
- [x] Barra de progreso animada debajo de la barra de navegación
- [x] Visible solo durante carga de página
- [x] Animación suave con gradiente del color accent
- [x] Desaparece automáticamente al completar la carga

### 10.5 Cleanup Final
- [x] Eliminada dependencia `electron-store` (reemplazada por JSON simple en Fase 5)
- [x] Eliminados directorios vacíos (`src/main/store/`, `src/main/ipc/`)
- [x] `.gitignore` actualizado: `*.tgz`, `icon_source.png`, `icon.iconset/`
- [x] Compilación exitosa de los tres targets
- [x] Todas las 10 fases completadas al 100%

### Archivos nuevos/modificados
- `src/main/window/AppMenu.ts` — **Nuevo**: menú nativo de la app
- `src/main/window/TabManager.ts` — Actualizado: `getActiveWebContents()`, `buildErrorPage()`, error page en `did-fail-load`
- `src/main/window/MainWindow.ts` — Actualizado: integra AppMenu
- `src/renderer/components/NavigationBar/NavigationBar.tsx` — Actualizado: loading progress bar
- `src/renderer/components/NavigationBar/NavigationBar.css` — Actualizado: estilos progress bar
- `.gitignore` — Actualizado: patrones adicionales
- `package.json` — Actualizado: eliminada dependencia electron-store

---

## Notas y Decisiones

| Fecha | Decisión | Razón |
|-------|----------|-------|
| 2026-02-18 | Electron sobre Tauri | Tauri no soporta navegación de contenido no confiable de forma segura |
| 2026-02-18 | yt-dlp binario standalone | Evita dependencia de Python en el usuario final |
| 2026-02-18 | WebContentsView sobre webview tag | webview está deprecated, WebContentsView es la API moderna |
| 2026-02-18 | Distribución directa, no App Store | YouTube downloading viola políticas de ambas tiendas |
| 2026-02-18 | pnpm como package manager | Preferencia del usuario, más eficiente en disco |
| 2026-02-18 | navigationHistory API | webContents.canGoBack/goForward están deprecated en Electron 40+ |
| 2026-02-18 | BaseWindow + WebContentsView | BaseWindow no tiene ready-to-show; usamos did-finish-load del appView |
| 2026-02-18 | before-input-event sobre globalShortcut | globalShortcut captura teclas de otras apps; before-input-event es local |
| 2026-02-18 | context-menu nativo (Electron Menu) | Más confiable y consistente con la plataforma que un menu React custom |
| 2026-02-18 | yt-dlp standalone binary (no Python) | El usuario final no necesita Python instalado; se empaqueta el binario |
| 2026-02-18 | ffmpeg empaquetado con la app | Necesario para merge audio+video; `--ffmpeg-location` apunta al bin/ |
| 2026-02-18 | child_process.spawn sobre wrapper npm | Control directo del proceso, parsing de progreso, manejo de cancelación |
| 2026-02-18 | Persistencia JSON simple sobre SQLite | Suficiente para estado de descargas; evita dependencia nativa adicional |

## Bugs Corregidos
| Fecha | Bug | Solución |
|-------|-----|----------|
| 2026-02-18 | Ruta incorrecta a renderer index.html | `__dirname` en MainWindow es `dist/main/window/`, necesita `../..` no `..` |
| 2026-02-18 | Deprecated canGoBack/canGoForward | Migrado a `webContents.navigationHistory.*` |
| 2026-02-18 | BaseWindow no tiene evento ready-to-show | Usar `appView.webContents.on('did-finish-load')` |
