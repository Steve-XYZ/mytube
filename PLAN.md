# MyTube - Plan de Implementación Completo

## Visión del Producto

**MyTube** es una aplicación de escritorio multiplataforma (macOS + Windows) que combina un navegador web integrado con capacidades de descarga de videos e imágenes. Permite navegar por Google, YouTube y la internet en general, y descargar contenido multimedia directamente desde las URLs visitadas.

---

## 1. Stack Tecnológico Seleccionado

| Componente | Tecnología | Justificación |
|-----------|-----------|---------------|
| Framework | **Electron v33+** | Único framework que soporta navegación web completa en contenido no confiable con consistencia cross-platform |
| Lenguaje | **TypeScript 5.x** | Tipado estático para un proyecto de esta complejidad |
| UI Framework | **React 19** | Ecosistema maduro, gran comunidad |
| Bundler | **Vite 6.x** | Velocidad de desarrollo superior a webpack |
| Navegador embebido | **WebContentsView** | API moderna de Electron (reemplaza BrowserView deprecated) |
| Descarga de video | **yt-dlp** (binario empaquetado) | Soporta 1000+ sitios, mantenido activamente |
| Conversión de video | **ffmpeg** (via ffmpeg-static) | Necesario para merge de streams audio+video |
| Procesamiento de imágenes | **sharp** | Alto rendimiento, bindings nativos |
| Almacenamiento de preferencias | **electron-store** | JSON encriptado |
| Empaquetado | **electron-builder v25+** | Soporte completo para macOS y Windows |
| Auto-actualización | **electron-updater** | Integrado con electron-builder |
| CI/CD | **GitHub Actions** | Builds nativos en macOS y Windows |

### ¿Por qué Electron y no Tauri?

Tauri es excelente para apps ligeras, pero sus propios mantenedores advierten: *"Ejecutar contenido no confiable en Tauri es altamente inseguro y no recomendado."* Tauri usa diferentes engines según el SO (WebKit en macOS, WebView2 en Windows), generando inconsistencias. Para una app que navega YouTube, Google y la web general, Electron con su Chromium completo es la única opción viable.

---

## 2. Arquitectura de la Aplicación

```
┌──────────────────────────────────────────────────────────┐
│                    BaseWindow (Main)                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  App Shell (React/Renderer Process)                │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Tab Bar | Nav Controls | URL Bar | Actions  │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Download Manager Panel (slide-out)           │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  WebContentsView (Active Browser Tab)              │  │
│  │  - Navegación web completa                         │  │
│  │  - Interceptación de requests                      │  │
│  │  - Detección de media                              │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                  Main Process (Node.js)                    │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐  │
│  │Tab Manager│ │Download  │ │yt-dlp     │ │Settings   │  │
│  │           │ │Queue     │ │Controller │ │Manager    │  │
│  └──────────┘ └──────────┘ └───────────┘ └───────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐                │
│  │Media     │ │FFmpeg    │ │IPC        │                │
│  │Detector  │ │Controller│ │Bridge     │                │
│  └──────────┘ └──────────┘ └───────────┘                │
└──────────────────────────────────────────────────────────┘
```

### Procesos y Responsabilidades

**Main Process (Node.js):**
- Gestión de ventanas y WebContentsView (tabs)
- Ejecución de yt-dlp y ffmpeg como child processes
- Cola de descargas y persistencia
- Interceptación de requests de red (WebRequest API)
- Detección de media en páginas
- Almacenamiento de preferencias

**Renderer Process (React):**
- UI del App Shell (barra de tabs, controles de navegación, URL bar)
- Panel de descargas (progreso, acciones)
- Diálogos de selección de formato
- Configuración/preferencias
- Comunicación con Main via IPC (contextBridge)

**WebContentsView Instances (uno por tab):**
- Navegación web independiente
- Sandboxed (sin acceso a Node.js)
- Cada tab = proceso de renderizado separado

---

## 3. Consideraciones Legales

### YouTube ToS
YouTube prohíbe explícitamente la descarga de contenido por medios no autorizados. Esto es una **violación contractual**, no necesariamente criminal.

### Estrategia Legal para MyTube
1. **Disclaimers claros** en la app: "Solo descargue contenido que tenga permiso de descargar o que esté libremente disponible bajo Creative Commons"
2. **NO distribuir** via App Store ni Microsoft Store (serán rechazados)
3. **Distribución directa** (sitio web, GitHub Releases)
4. **Términos de uso** que transfieran responsabilidad al usuario
5. **Branding neutro**: "Navegador web con capacidades de descarga", no "YouTube Downloader"
6. **Primera ejecución**: mostrar acuerdo de usuario sobre uso responsable

---

## 4. Plan de Implementación por Fases

### FASE 1: Fundación y Configuración (Semana 1-2)

#### 1.1 Inicialización del Proyecto
- [ ] Inicializar proyecto con `npm init`
- [ ] Configurar TypeScript (`tsconfig.json`)
- [ ] Configurar Electron + Vite + React (usar template o configuración manual)
- [ ] Configurar ESLint + Prettier
- [ ] Configurar estructura de directorios:

```
mytube/
├── src/
│   ├── main/                    # Main process
│   │   ├── index.ts             # Entry point
│   │   ├── window/              # Window management
│   │   │   ├── MainWindow.ts
│   │   │   └── TabManager.ts
│   │   ├── download/            # Download engine
│   │   │   ├── DownloadManager.ts
│   │   │   ├── DownloadQueue.ts
│   │   │   ├── YtDlpController.ts
│   │   │   ├── FFmpegController.ts
│   │   │   └── ImageDownloader.ts
│   │   ├── media/               # Media detection
│   │   │   ├── MediaDetector.ts
│   │   │   └── RequestInterceptor.ts
│   │   ├── ipc/                 # IPC handlers
│   │   │   └── handlers.ts
│   │   └── store/               # Preferences
│   │       └── SettingsStore.ts
│   ├── renderer/                # Renderer process (React)
│   │   ├── index.html
│   │   ├── main.tsx             # React entry
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── TabBar/
│   │   │   ├── NavigationBar/
│   │   │   ├── DownloadPanel/
│   │   │   ├── FormatSelector/
│   │   │   ├── Settings/
│   │   │   └── common/
│   │   ├── hooks/
│   │   ├── store/               # Estado React (zustand o context)
│   │   └── styles/
│   ├── preload/                 # Preload scripts
│   │   ├── index.ts             # App shell preload
│   │   └── webview.ts           # Browser tab preload
│   └── shared/                  # Tipos compartidos
│       ├── types.ts
│       └── constants.ts
├── bin/                         # Binarios empaquetados
│   ├── yt-dlp/
│   └── ffmpeg/
├── build/                       # Recursos de build
│   ├── icon.icns                # macOS icon
│   ├── icon.ico                 # Windows icon
│   ├── icon.png                 # PNG icon
│   ├── entitlements.mac.plist
│   └── notarize.js
├── electron-builder.yml
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

#### 1.2 Configuración de Electron Base
- [ ] Crear `MainWindow` con `BaseWindow` + `WebContentsView`
- [ ] Configurar `preload` scripts con `contextBridge`
- [ ] Implementar IPC bridge básico (main ↔ renderer)
- [ ] Configurar seguridad: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
- [ ] Configurar Content Security Policy

#### 1.3 Configuración de Build
- [ ] Configurar `electron-builder.yml` para macOS y Windows
- [ ] Configurar `extraResources` para yt-dlp y ffmpeg binaries
- [ ] Script para descargar binarios de yt-dlp y ffmpeg para cada plataforma
- [ ] Verificar que el build funcione en ambas plataformas

---

### FASE 2: Navegador Web Integrado (Semana 3-5)

#### 2.1 Sistema de Tabs
- [ ] `TabManager` en main process: crear, destruir, cambiar, reordenar tabs
- [ ] Cada tab = `WebContentsView` independiente
- [ ] Gestión de ciclo de vida (load, unload, suspend background tabs)
- [ ] Componente React `TabBar` con:
  - Tabs con favicon y título
  - Botón de nueva tab (+)
  - Cerrar tab (x)
  - Drag & drop para reordenar
  - Indicador de carga

#### 2.2 Barra de Navegación
- [ ] Componente `NavigationBar` con:
  - Botones Back / Forward / Reload / Stop
  - Barra de URL con autocompletado básico
  - Indicador de seguridad (HTTPS lock icon)
  - Botón de descarga (detecta media disponible)
  - Menú de opciones
- [ ] IPC commands: navigate, goBack, goForward, reload, stop

#### 2.3 Funcionalidades del Navegador
- [ ] Navegación estándar (clicks, formularios, redirects)
- [ ] Manejo de nuevas ventanas / popups (abrir en nueva tab)
- [ ] Soporte de permisos (cámara, micrófono, notificaciones, geolocalización)
- [ ] Manejo de descargas nativas del navegador (PDFs, archivos)
- [ ] Historial de navegación en sesión
- [ ] Zoom in/out (Cmd/Ctrl + / -)
- [ ] Find in page (Cmd/Ctrl + F)
- [ ] Context menu (click derecho): abrir en nueva tab, copiar URL, guardar imagen

#### 2.4 Página de Inicio
- [ ] New Tab Page con:
  - Barra de búsqueda (Google)
  - Accesos directos a YouTube, Google, sitios frecuentes
  - Diseño limpio y minimalista

---

### FASE 3: Motor de Descarga de Videos (Semana 6-8)

#### 3.1 Integración con yt-dlp
- [ ] `YtDlpController`: wrapper sobre child_process para ejecutar yt-dlp
- [ ] Script de setup para descargar binarios de yt-dlp por plataforma/arquitectura
- [ ] Resolución de ruta al binario (dev vs production)
- [ ] Métodos principales:
  - `getVideoInfo(url)`: ejecuta `--dump-json`, retorna metadata
  - `getFormats(url)`: lista formatos disponibles
  - `download(url, options)`: inicia descarga con tracking de progreso
  - `cancel(downloadId)`: cancela descarga en curso
- [ ] Parsing de progreso stdout: porcentaje, velocidad, ETA, tamaño
- [ ] Manejo de errores: URL inválida, video privado, geobloqueado, rate limiting

#### 3.2 Integración con FFmpeg
- [ ] `FFmpegController`: manejo del binario ffmpeg
- [ ] Bundling via `ffmpeg-static` o descarga manual por plataforma
- [ ] Configurar yt-dlp para usar el ffmpeg empaquetado (`--ffmpeg-location`)
- [ ] Post-procesamiento: merge audio+video, conversión de formato
- [ ] Extracción de thumbnails

#### 3.3 Selector de Formato
- [ ] Diálogo modal `FormatSelector`:
  - Thumbnail del video + título + duración
  - Lista de formatos disponibles (resolución, codec, tamaño estimado)
  - Presets rápidos: "Mejor Calidad", "Menor Tamaño", "Solo Audio"
  - Selector de formato de salida (MP4, MKV, WebM, MP3, M4A)
  - Opción de descargar subtítulos
  - Botón de descarga

#### 3.4 Cola de Descargas
- [ ] `DownloadQueue` con estados: queued, downloading, paused, completed, failed
- [ ] Límite configurable de descargas concurrentes (default: 3)
- [ ] Soporte para pausa/reanudación (`--continue` de yt-dlp)
- [ ] Persistencia de cola en disco (better-sqlite3 o JSON)
- [ ] Recuperación de descargas tras cierre/crash de la app
- [ ] Reintentos automáticos con backoff exponencial

#### 3.5 Download Manager UI
- [ ] Panel `DownloadPanel` (slide-out lateral o tab dedicada):
  - Lista de descargas con: thumbnail, título, barra de progreso, velocidad, ETA
  - Acciones por descarga: pausar, reanudar, cancelar, abrir archivo, abrir carpeta
  - Filtros: activas, completadas, fallidas
  - Acciones en lote: pausar todo, reanudar todo, limpiar completadas
  - Notificación de descarga completada

---

### FASE 4: Descarga de Imágenes (Semana 9-10)

#### 4.1 Detección de Imágenes en Página
- [ ] `MediaDetector`: usar WebRequest API para interceptar recursos tipo `image`
- [ ] Inyección de script en WebContentsView para extraer todos los `<img>` src
- [ ] Detección de imágenes de alta resolución (filtrar thumbnails/icons)
- [ ] Detección de imágenes en background CSS

#### 4.2 Descarga de Imágenes
- [ ] `ImageDownloader`:
  - Descarga directa vía `https` module (Node.js)
  - Soporte para headers (referer, cookies) necesarios en algunos sitios
  - Naming automático basado en URL o título de página
  - Descarga de imágenes individuales o en batch
- [ ] Conversión de formato con `sharp` (WebP → PNG/JPG, etc.)
- [ ] Generación de thumbnails para preview

#### 4.3 UI de Descarga de Imágenes
- [ ] Galería de imágenes detectadas en la página actual
- [ ] Selector de imágenes (checkboxes para selección múltiple)
- [ ] Preview de imagen antes de descargar
- [ ] Opción de formato y calidad de salida
- [ ] Integración con el panel de descargas existente

#### 4.4 Context Menu para Imágenes
- [ ] Click derecho en imagen → "Guardar imagen como..."
- [ ] Click derecho → "Copiar URL de imagen"
- [ ] Click derecho → "Abrir imagen en nueva tab"

---

### FASE 5: Configuración y Preferencias (Semana 11)

#### 5.1 Settings Manager
- [ ] `SettingsStore` usando `electron-store` con esquema de validación
- [ ] Preferencias:
  - **General**: idioma, tema (claro/oscuro/sistema), inicio con el sistema
  - **Descargas**: directorio por defecto, calidad preferida, formato preferido, descargas concurrentes
  - **Navegador**: motor de búsqueda, página de inicio, bloqueo de popups
  - **Red**: proxy (HTTP/SOCKS5), límite de ancho de banda
  - **Avanzado**: ubicación de yt-dlp custom, ubicación de ffmpeg custom

#### 5.2 UI de Configuración
- [ ] Ventana/tab de configuración con secciones organizadas
- [ ] Cambios aplicados en tiempo real donde sea posible
- [ ] Botón de resetear a valores por defecto
- [ ] Exportar/importar configuración

---

### FASE 6: Detección Inteligente de Media (Semana 12)

#### 6.1 Botón de Descarga Contextual
- [ ] Detectar automáticamente cuando el usuario está en una página con video descargable
- [ ] Cambiar icono/color del botón de descarga cuando hay media disponible
- [ ] Badge con número de medios detectados
- [ ] Al hacer click: mostrar opciones de descarga inmediatas

#### 6.2 Interceptor de Requests
- [ ] `RequestInterceptor` usando `session.webRequest`:
  - Monitorear requests de tipo `media`, `xmlhttprequest`
  - Detectar streams de video/audio (DASH, HLS manifests)
  - Mantener registro de URLs de media por tab
  - Filtrar falsos positivos (ads, trackers)

#### 6.3 Soporte Multi-sitio
- [ ] Verificar compatibilidad con sitios populares:
  - YouTube (videos, shorts, playlists)
  - Vimeo
  - Twitter/X (videos en tweets)
  - Instagram (reels, posts)
  - TikTok
  - Facebook
  - Dailymotion
  - Reddit (videos en posts)
- [ ] Fallback genérico para sitios no soportados por yt-dlp

---

### FASE 7: Pulido y UX (Semana 13-14)

#### 7.1 Atajos de Teclado
- [ ] `Cmd/Ctrl + T`: Nueva tab
- [ ] `Cmd/Ctrl + W`: Cerrar tab actual
- [ ] `Cmd/Ctrl + L`: Focus en barra de URL
- [ ] `Cmd/Ctrl + D`: Descargar media de la página actual
- [ ] `Cmd/Ctrl + J`: Abrir/cerrar panel de descargas
- [ ] `Cmd/Ctrl + Shift + I`: DevTools (solo en desarrollo)
- [ ] `Cmd/Ctrl + Tab / Cmd/Ctrl + Shift + Tab`: Cambiar tabs
- [ ] `Cmd/Ctrl + 1-9`: Ir a tab N
- [ ] `Cmd/Ctrl + +/-/0`: Zoom

#### 7.2 Temas y Apariencia
- [ ] Tema claro y oscuro
- [ ] Seguir preferencia del sistema
- [ ] CSS variables para theming consistente
- [ ] Adaptar UI a cada plataforma (title bar nativo vs custom)

#### 7.3 Notificaciones
- [ ] Notificación nativa del SO al completar descarga
- [ ] Sonido opcional de completado
- [ ] Badge en el dock/taskbar con descargas activas

#### 7.4 Internacionalización (i18n)
- [ ] Soporte para español e inglés (mínimo)
- [ ] Usar `i18next` + `react-i18next`
- [ ] Detección automática del idioma del sistema

#### 7.5 Manejo de Errores
- [ ] UI de error amigable (no stack traces)
- [ ] Reporte de errores con contexto
- [ ] Logging con `electron-log`
- [ ] Crash reporter integrado

---

### FASE 8: Seguridad y Rendimiento (Semana 15)

#### 8.1 Seguridad
- [ ] Auditoría de seguridad de configuración Electron:
  - `sandbox: true` en todos los renderers
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - CSP headers restrictivos
  - `session.setPermissionRequestHandler` configurado
- [ ] Validación de todas las URLs antes de navegar
- [ ] Sanitización de nombres de archivo
- [ ] Prevención de path traversal en descargas
- [ ] Certificate error handling
- [ ] No almacenar credenciales en plain text (usar OS keychain via `keytar`)

#### 8.2 Rendimiento
- [ ] Tab suspension para tabs inactivas (liberar memoria tras timeout)
- [ ] Límite de tabs simultáneas
- [ ] Limpieza de child processes (yt-dlp, ffmpeg) al cerrar tabs/app
- [ ] Memory profiling y optimización
- [ ] Lazy loading de componentes React
- [ ] Debounce en operaciones frecuentes (resize, scroll)

#### 8.3 Testing
- [ ] Unit tests con Vitest para lógica de negocio
- [ ] Integration tests para IPC communication
- [ ] E2E tests con Playwright o Spectron
- [ ] Test de descarga con URLs conocidas
- [ ] Test de compatibilidad en macOS 12+ y Windows 10+

---

### FASE 9: Empaquetado y Distribución (Semana 16-17)

#### 9.1 Empaquetado macOS
- [ ] Configurar electron-builder para macOS:
  - Target: `.dmg` + `.zip` (para auto-update)
  - Arquitecturas: Universal (x64 + arm64)
  - Categoría: `public.app-category.utilities`
- [ ] Iconos: `.icns` con todas las resoluciones
- [ ] `entitlements.mac.plist` con permisos necesarios:
  - `com.apple.security.cs.allow-unsigned-executable-memory` (para ffmpeg)
  - `com.apple.security.network.client`
  - Hardened Runtime habilitado
- [ ] Code signing con Apple Developer certificate
- [ ] Notarización con `@electron/notarize`
- [ ] Verificar que Gatekeeper acepte la app

#### 9.2 Empaquetado Windows
- [ ] Configurar electron-builder para Windows:
  - Target: NSIS installer + portable
  - Arquitecturas: x64
- [ ] Iconos: `.ico` con múltiples resoluciones
- [ ] Configurar NSIS: instalación per-user, opción de directorio, accesos directos
- [ ] Code signing (EV certificate o Azure Trusted Signing)
- [ ] Verificar SmartScreen behavior
- [ ] Asociación de protocolos/archivos (opcional)

#### 9.3 Auto-actualización
- [ ] Configurar `electron-updater` con GitHub Releases como servidor
- [ ] Flujo: check for updates → download → notify → install on restart
- [ ] Actualizaciones diferenciales para reducir tamaño de descarga
- [ ] Opción de actualización automática o manual en settings
- [ ] Self-update de yt-dlp (actualizar el binario independientemente de la app)

#### 9.4 CI/CD con GitHub Actions
- [ ] Workflow para macOS:
  - Runner: `macos-latest`
  - Build universal binary
  - Code sign + notarize
  - Upload artifacts
- [ ] Workflow para Windows:
  - Runner: `windows-latest`
  - Build x64
  - Code sign
  - Upload artifacts
- [ ] Workflow de release:
  - Trigger en tags (`v*`)
  - Build ambas plataformas en paralelo
  - Publicar en GitHub Releases
  - Generar release notes automáticas
- [ ] Workflow de CI (PRs):
  - Lint + type check
  - Unit tests
  - Build (sin signing)

---

### FASE 10: Pre-producción y Launch (Semana 18)

#### 10.1 Disclaimer Legal y Onboarding
- [ ] Pantalla de primer uso con acuerdo de términos
- [ ] Disclaimer: "Use esta aplicación responsablemente. Solo descargue contenido del cual tenga los derechos o permisos necesarios."
- [ ] Tour rápido de funcionalidades

#### 10.2 Documentación
- [ ] README.md completo con instrucciones de build
- [ ] CONTRIBUTING.md para contribuidores
- [ ] Página de releases con changelogs
- [ ] FAQ con preguntas comunes

#### 10.3 Landing Page (opcional)
- [ ] Sitio web simple con:
  - Descripción del producto
  - Screenshots
  - Botones de descarga para macOS y Windows
  - FAQ y documentación

#### 10.4 Testing Final
- [ ] QA completo en macOS (Intel + Apple Silicon)
- [ ] QA completo en Windows 10 y 11
- [ ] Test de actualización (instalar versión vieja, verificar update)
- [ ] Test de instalación limpia en ambas plataformas
- [ ] Performance benchmarks
- [ ] Pruebas de descarga en sitios principales

---

## 5. Dependencias Principales (package.json)

```json
{
  "dependencies": {
    "electron-store": "^10.0.0",
    "electron-updater": "^6.0.0",
    "electron-log": "^5.0.0",
    "better-sqlite3": "^11.0.0",
    "sharp": "^0.33.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "@electron/notarize": "^2.0.0",
    "typescript": "^5.6.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vitest": "^2.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0"
  }
}
```

**Binarios empaquetados (no npm):**
- `yt-dlp` — binario standalone (sin dependencia de Python)
- `ffmpeg` + `ffprobe` — via `ffmpeg-static` o descarga manual

---

## 6. Riesgos y Mitigaciones

| Riesgo | Impacto | Probabilidad | Mitigación |
|--------|---------|-------------|------------|
| YouTube cambia su API/player | Alto | Alta | yt-dlp se actualiza rápido; implementar self-update del binario |
| Rechazo en App Store / MS Store | Medio | Certeza | Distribución directa desde el inicio |
| Alto consumo de memoria | Medio | Alta | Tab suspension, límite de tabs, monitoreo |
| Problemas de code signing | Medio | Media | Documentar proceso; presupuestar certificados |
| Cambios en yt-dlp | Bajo | Baja | Abstracción en `YtDlpController`; fácil de actualizar |
| SmartScreen bloquea instalador | Medio | Alta sin EV cert | Obtener EV certificate o usar Azure Trusted Signing |

---

## 7. Requisitos de Plataforma

### macOS
- **Mínimo:** macOS 10.15 (Catalina)
- **Recomendado:** macOS 12+ (Monterey)
- **Arquitecturas:** Universal (Intel x64 + Apple Silicon arm64)
- **Code Signing:** Apple Developer Program ($99/año)
- **Notarización:** Obligatoria para evitar advertencias de Gatekeeper

### Windows
- **Mínimo:** Windows 10
- **Recomendado:** Windows 10 21H2+
- **Arquitecturas:** x64 (arm64 opcional)
- **Code Signing:** EV Certificate (~$300-500/año) o Azure Trusted Signing
- **Instalador:** NSIS (con opción portable)

---

## 8. Cronograma Resumido

| Fase | Descripción | Duración | Semanas |
|------|-------------|----------|---------|
| 1 | Fundación y Configuración | 2 semanas | 1-2 |
| 2 | Navegador Web Integrado | 3 semanas | 3-5 |
| 3 | Motor de Descarga de Videos | 3 semanas | 6-8 |
| 4 | Descarga de Imágenes | 2 semanas | 9-10 |
| 5 | Configuración y Preferencias | 1 semana | 11 |
| 6 | Detección Inteligente de Media | 1 semana | 12 |
| 7 | Pulido y UX | 2 semanas | 13-14 |
| 8 | Seguridad y Rendimiento | 1 semana | 15 |
| 9 | Empaquetado y Distribución | 2 semanas | 16-17 |
| 10 | Pre-producción y Launch | 1 semana | 18 |

**Total estimado: ~18 semanas (4.5 meses)**

---

## 9. Próximos Pasos Inmediatos

Para comenzar la implementación:

1. **Inicializar el proyecto** con Electron + Vite + React + TypeScript
2. **Crear la ventana principal** con BaseWindow + WebContentsView
3. **Implementar el sistema de tabs** básico
4. **Agregar barra de navegación** funcional
5. **Integrar yt-dlp** para primera descarga de prueba
