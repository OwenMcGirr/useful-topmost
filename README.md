# Useful Topmost

A frameless full-screen Electron dashboard where each widget is generated
on the fly by the [OpenAI Codex CLI][codex-cli]. You type a prompt at the
`+` button — "show me my city's weather", "Bitcoin price ticker",
"countdown to my next meeting" — and Codex writes a self-contained HTML
widget that renders in a sandboxed `<webview>` tile and refreshes itself
on its own interval. The dashboard persists across restarts.

The product hypothesis: instead of building or installing widgets, the
user *describes* what they want to see and the system writes the widget
for them.

[codex-cli]: https://github.com/openai/codex

## Requirements

- **Node.js 20+** — for Vitest, electron-vite, and the bundled Electron
  runtime. Tested with the Node version that ships inside Electron 33.
- **OpenAI Codex CLI** installed and authenticated. The app shells out to
  `codex exec` per prompt; without it you'll see the SetupScreen.

  ```bash
  npm install -g @openai/codex
  codex login
  ```

- **Windows, macOS, or Linux** with a display. The app is frameless
  full-screen and assumes a real desktop session.

## Install

```bash
git clone <this-repo>
cd useful-topmost
npm install
```

## Run

```bash
npm run dev
```

This starts electron-vite — it builds the main and preload processes
once, starts a Vite dev server for the renderer, and launches Electron
pointed at it. A frameless dark window should fill your primary monitor.

### Windows + nvm gotcha

If you use nvm-windows, `electron.exe` will refuse to start as a desktop
app whenever `ELECTRON_RUN_AS_NODE=1` is set in your shell environment
(some Node tooling sets this). Unset it before launching:

```bash
unset ELECTRON_RUN_AS_NODE
npm run dev
```

If the SetupScreen appears even though `codex --version` works in your
shell, the issue is that npm-global CLIs install as `.cmd` shims on
Windows and Node's `child_process.spawn` doesn't resolve them without
`shell: true`. The app already passes `shell: true`; you shouldn't hit
this. File an issue if you do.

## How widgets work

1. You click the `+` button (bottom-right) and type a prompt.
2. The renderer asks the main process to create a widget; a "building
   widget…" tile appears immediately.
3. Main spawns `codex exec` with a working directory of
   `userData/widgets/{uuid}/` and pipes the prompt to stdin. The system
   prompt instructs Codex to write a single self-contained `index.html`
   with inline JS/CSS, prefer keyless public APIs (Open-Meteo,
   Wikipedia, public RSS, GitHub public endpoints), and bake an
   appropriate `setInterval` for self-refresh.
4. Main polls for `index.html` to appear and resolves the moment it
   does. The renderer flips the tile from `building` to `live` and
   points an Electron `<webview>` at the file. The widget's inline JS
   takes over and refreshes itself on its own schedule.

### Persistence

All state lives under Electron's `userData` directory:

```
userData/
  dashboard.json         # { "widgets": [uuid1, uuid2, ...] }
  widgets/
    {uuid}/
      index.html         # the Codex-generated widget
      meta.json          # { prompt, created_at }
      codex.log          # captured stderr (useful when a widget came out wrong)
```

Restarting the app reloads every widget from disk — no Codex calls.

### Authenticated APIs

Click the gear icon next to the `+` button to open the providers panel.
Add an entry — for example "OpenWeather" with hostname
`api.openweathermap.org`, query-string auth, param `appid`, and your
key. Codex is told the provider exists (by name + base URL) but never
sees the secret value. Inside each widget, calls to those hostnames go
through `window.appFetch` (a drop-in for `fetch`); a main-process
proxy injects the auth header or query param before performing the
upstream request. The key never enters the widget's renderer process.

Provider records live at `userData/secrets.json` as plain JSON for
now. OS-keychain encryption via Electron's `safeStorage` is a planned
follow-up.

### Re-prompt and retry

- **Refresh** (on a live tile) reloads the webview. The widget's inline
  fetch re-runs.
- **Re-prompt** opens the modal pre-filled with the original prompt; on
  submit, a new widget is generated and the old one is dropped *only
  once the new one is ready*. If the new generation fails, the old
  widget stays and the failed placeholder is removed.
- **Retry** (on an error tile) re-runs Codex with the same prompt.
- **Dismiss** removes the tile and deletes its folder.

## Security model

- The main `BrowserWindow` runs with `contextIsolation: true`,
  `nodeIntegration: false`, and a tight preload that exposes only the
  IPC channels the dashboard needs.
- Each widget renders in an Electron `<webview>` — a separate
  out-of-process renderer with browser-level capabilities only. The
  widget HTML can `fetch()` external URLs, but cannot touch the
  filesystem or invoke Node APIs.
- Codex itself is invoked with
  `--dangerously-bypass-approvals-and-sandbox`. The per-widget folder
  under `userData/` is a transient scratch directory by design, but
  this flag is documented Codex behavior — be aware that Codex has
  full filesystem access during generation and rely on its sandbox
  protections accordingly.

## Development

```bash
npm test            # vitest, one shot
npm run test:watch  # interactive
npm run build       # electron-vite build (main + preload + renderer)
```

Tests cover:
- `codex-runner` with a mocked child_process spawn
- `widget-store` against a temp directory
- `ipc` handlers against fake `ipcMain` / sender
- React components (`Dashboard`, `Tile`, `PromptModal`) with
  `@testing-library/react` under jsdom

There's no end-to-end Electron test; the manual smoke test (open the
app, create a widget, restart, confirm it persists) is the integration
test for now.

## Known limits

- **Keyless APIs only.** No secrets management; if a widget needs an
  API key, it would have to bake it into the generated HTML, which
  isn't supported by the system prompt. A `window.SECRETS` injection
  layer is a natural next addition.
- **Re-prompted widget appears at the end of the grid**, not at the
  source tile's position. Flow layout, MVP.
- **Single monitor, single dashboard.** No drag-to-reorder, no resize.
- **Codex's HTML is trusted.** No validation or sandboxing beyond the
  webview process boundary.

## License

[MIT](LICENSE) — Copyright (c) 2026 Owen McGirr.
