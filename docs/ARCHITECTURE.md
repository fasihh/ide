# Architecture

```
┌──────────────────────────── browser ────────────────────────────┐
│ apps/web  (React shell)                                         │
│  core/: settings · workspace · runner · layout · keybindings    │
│         plugin-host (builds a ctx per plugin)                   │
│  shell/: TopBar · Dock (dockview) · StatusBar                   │
│                ▲ panels/commands/items registered by plugins    │
│  plugins/*/src/web.tsx  ── ctx (public API) ──┘                 │
└───────────────┬─────────────────────────────────────────────────┘
                │ hc<AppType>  /api/*          ctx.rpc() /api/plugins/<id>/*
┌───────────────▼──────────── node ───────────────────────────────┐
│ apps/server  (Hono)                                             │
│  routes/ → services/{settings, problems} · runner/              │
│  plugin-host → plugins/*/src/server.ts (routes + setup)         │
└───────────────┬─────────────────────────────────────────────────┘
                ▼
   ~/cp/…                    problems (plain files, user-visible)
   ~/.cp-ide/settings.json   overrides only
   ~/.cp-ide/templates/      template library (main.cpp, main.py, multitest.cpp, …)
   ~/.cp-ide/snippets/       snippet library (dsu.cpp, binpow.cpp, …)
   ~/.cp-ide/cache/          compiled binaries keyed by content hash
   ~/.cp-ide/plugins/<id>/   private plugin storage
```

## Packages

| Path | Role |
|---|---|
| `packages/shared` | Domain types + zod schemas (`problem.json`, tests, verdicts), settings descriptor system and core settings, output comparator |
| `packages/plugin-api` | Types/helpers for plugins: `./web` (WebPluginContext, definePlugin) and `./server` (ServerPluginContext, defineServerPlugin), `Emitter`, disposables |
| `packages/ui` | shadcn-style components (compact sizes) + design tokens (`styles.css`), incl. verdict colours |
| `packages/editor` | Monaco setup (local bundle, workers, themes from CSS tokens, overflow widget host) + `CodeEditor` (settings, Vim), LSP → Monaco providers (`registerLanguageFeatures`), `fileModelPath` |
| `packages/cache` | General caches with no dependencies (server or browser): `LruCache`, `SwrCache` (stale-while-revalidate, deduped loads) |
| `packages/lsp-client` | Transport-agnostic JSON-RPC connection + LSP client (handshake, document sync, diagnostics); no editor dependency |
| `apps/server` | Hono API, services, runner, server plugin host. Exports `AppType` |
| `apps/web` | Shell (dock, top/status bar, quick input) + core stores + web plugin host. No feature UI lives here |
| `plugins/core` | All built-in tools (explorer, editor, tests, output, problem, settings, toolbar/status items) |
| `plugins/toolchain` | Example full-stack plugin (server route + panel + contributed setting) |
| `plugins/format` | Formatter: server route running clang-format / black, format command, format on save |
| `plugins/palette` | Command palette (modes by prefix), top-bar search box, `palette` service for other plugins |
| `plugins/python-warm` | Warm start for live Python runs: a `ProcessLauncher` with a standby interpreter (`warm_bootstrap.py`) |
| `plugins/lsp-clangd` | Registers clangd (C++) with core: command from PATH/setting, fallback flags from the C++ settings |
| `plugins/lsp-basedpyright` | Registers basedpyright (Python, bundled npm dependency) with core |
| `plugins/competitive-companion` | Local HTTP receiver for the Competitive Companion extension: creates/updates problems with samples, announces imports via `ctx.broadcast` |
| `plugins/playground` | Playground editor + xterm terminal, live runs over a WebSocket, files in `playground.folder` |

Internal packages export TypeScript source directly (no build step); Vite and tsx compile them.
Imports use explicit `.ts` extensions (`allowImportingTsExtensions`).

## Data model

```
<problems.root>/<platform-slug>/<group-slug>/<name-slug>/
  problem.json   # ProblemMeta: name, platform, group, url, language, mainFile, timeLimitMs?,
                 #   memoryLimitMb?, status (todo|attempted|solved), tags, notes, createdAt, updatedAt
  tests.json     # TestCase[]: { id, input, expected, isSample, enabled }
  main.cpp|py    # created from a template (default per language: templates.defaultCpp/Python)
<problems.root>/.trash/<timestamp>-<name>/   # deleted problems (+ .cp-ide-trash.json with the old id)
```

A problem's **id** is its folder path relative to the root (posix `/`). The server scans the root
(depth ≤ 5) for `problem.json`; there is no database. Duplicate names get `-2`, `-3` suffixes.
Scratch problems go to `scratch/<yyyy-mm-dd>/scratch-<hhmmss>`.

## API (`apps/server/src/app.ts`, `routes/index.ts`)

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/plugins` | server plugin infos |
| `GET/PATCH /api/settings` | effective values + overrides; PATCH a partial map (`null` resets) |
| `GET /api/problems` | list (`{ root, problems }`) |
| `GET /api/problems/detail?id=` | meta + tests + file contents |
| `POST /api/problems`, `POST /api/problems/scratch` | create |
| `PATCH /api/problems/meta` · `PUT /api/problems/file` · `PUT /api/problems/tests` | update |
| `POST /api/problems/file/{create,delete,rename}` | extra files in a problem (returns the refreshed problem) |
| `POST /api/problems/{move,trash,restore}` | rename/move a problem folder, move to `.trash`, restore |
| `GET/PUT /api/library/:kind`, `POST /api/library/:kind/{create,rename,delete}` | templates / snippets |
| `GET /api/events` | SSE stream of `ServerEvent`s (problems changed on disk) |
| `GET /api/lsp/servers` · `WS /api/lsp?server=<id>` | registered language servers (availability, init options) · editor ↔ language server bridge |
| `WS /api/plugins/<id>/<path>` | plugin WebSockets (`SocketRouter` in `apps/server/src/sockets.ts`; non-local `Origin` rejected) |
| `POST /api/run/compile` | `{ language, source, fileName }` → `CompileResult` (`artifactId`) |
| `POST /api/run/exec` | `{ artifactId, input, expected?, timeLimitMs?, compareMode?, floatEpsilon? }` → `ExecResult` |
| `POST /api/run/interact` | `{ artifactId, interactorArtifactId, input, expected?, timeLimitMs? }` → `ExecResult` with `transcript` |
| `/api/plugins/<id>/*` | plugin routes |

Errors are always `{ error: string }` with a 4xx/5xx status (`HttpError`, zod, validator hook).
The web client uses `unwrap(api.x.$get())`, which throws the message and returns the typed body.

## Run flow

1. `runner.run()` (web, `apps/web/src/core/runner.ts`) saves dirty buffers in the background and
   marks tests queued.
2. `POST /run/compile` with the **current buffer** (not the file on disk). The server hashes
   compiler + flags + source; a cached binary is reused. Diagnostics have the temp path replaced by
   the user's file name. On Windows a fresh `.exe` gets a warm-up launch so antivirus scanning does
   not count against the first test.
3. Tests run through `POST /run/exec` with client-side concurrency (`runner.maxConcurrency`); the
   server also caps concurrent processes. Results stream into the store test by test.
4. Verdict: spawn error/RE (non-zero exit, explained) → TLE (killed at TL × `killAfterFactor`, or
   finished over TL) → OLE → RAN (no expected output) → AC/WA via `compareOutput`.
5. Events: `run:started`, `run:compiled`, `run:test-finished`, `run:finished`.

Timing is wall-clock including process start (~10–30 ms on Windows). Memory is not limited yet.

## Web shell

- **Registry** (`core/registry.ts`): zustand store of contributions; each carries its owner `ctx`.
- **Layout** (`core/layout.ts`): every panel is the single dockview component `plugin-panel` with
  `params.panelId`, so saved layouts survive plugin changes. Default layout is built from
  `defaultOpen` panels by `placement` (center first, then left/right/bottom). Layout JSON is saved to
  `localStorage["cp-ide.layout.v1"]`; `defaultRenderer="always"` keeps hidden tabs mounted (Monaco state).
  Side/bottom group pixel sizes are remembered and re-applied after window resizes so the editor
  absorbs them. Presets (`layout.registerPreset`) list panels to open; saved layouts store full JSON.
- **Quick input** (`core/ui.ts`, `shell/QuickInput.tsx`): one modal for `ctx.ui.quickPick/prompt/confirm`;
  fuzzy matching in `core/fuzzy.ts`.
- **Keybindings** (`core/keybindings.ts`): one capture-phase `keydown` listener matches command
  keybindings (user overrides from the `keybindings` setting applied), so commands beat Monaco's own
  bindings. It also implements `recordKeybinding`. Browsers reserve some combos (Ctrl+N/T/W).
- **Theme** (`core/theme.ts`): toggles `.dark` on `<html>`, sets `--ui-font-size`/`--editor-font`.
  dockview is themed by `.dockview-theme-cp` in `apps/web/src/index.css`; Monaco themes are derived
  from CSS tokens at runtime (`plugins/core/src/editor/monaco.ts`).
- **Workspace** (`core/workspace.ts`): open problem, buffers (`content` vs `saved`), debounced
  autosave and tests save, last problem restored from localStorage.
- **Live sync** (`core/server-events.ts`): EventSource on `/api/events`; on `problems-changed` the list
  refreshes quietly and `reconcileFromDisk` updates the open problem (clean buffers take disk content,
  dirty ones are kept; tests replaced unless a local save is pending). A watchdog reconnects when the
  20s pings stop (dev proxies can leave dead connections after a server restart).
- Dev only: `window.__cp` exposes stores and services for debugging.

## Testing

- `packages/shared`: `node --test` unit tests (comparator).
- `apps/server`: `tsx --test` integration tests using the real g++/python and a temp `CP_IDE_HOME`.
- `pnpm typecheck` runs `tsc` in every package via turbo.
