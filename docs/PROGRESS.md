# Progress log

Newest first. Update this when you finish a chunk of work: what changed, what was verified, what is
left. Phase checklists live in [PLAN.md](PLAN.md).

## 2026-10-08 — Phase 5 complete (Playground)

- Interactive mode made discoverable first: the box moved under Status/Language in the Problem panel,
  a Standard/Interactive toggle chip in the Tests header, commands `problems.toggleInteractive` and
  `problems.openInteractor`.
- **Server**: `sockets.ts` (`SocketRouter`, `ws` noServer, rejects non-local `Origin` — browsers don't
  apply CORS to WebSockets), `ctx.websocket(path, handler)` for plugins at `/api/plugins/<id>/<path>`,
  `RunnerService.start` (live session: write/end/kill, stdout/stderr/exit callbacks, Python
  unbuffered, max run time, output cap). Vite proxies `/api` WebSockets (`ws: true`).
- **`@cp-ide/editor`** (new package): Monaco setup, themes, overflow host and Vim moved out of the core
  plugin; `CodeEditor` component used by the core editor, Templates & Snippets and the Playground.
- **Keybindings**: `CommandContribution.when`; commands with a satisfied condition win over
  unconditional ones.
- **`plugins/playground`**: server half (files in `playground.folder`, starter `main.cpp`, run socket)
  and web half (store with autosave + socket client, `PlaygroundPanel`, `TerminalPanel` with line
  editing, commands, layout preset).
- **Verified**: run socket end to end through the Vite proxy (prompt before input, stdin, stderr
  separate, exit code); terminal run triggered from the Playground with input typed into xterm (exit 0);
  file create/save/list in the playground folder; save-as-problem path. Tests: 27 passing (new: live
  session I/O + kill, WebSocket origin rejection). **Not visually verified**: the terminal rendering
  itself — the browser pane was hidden during testing.

## 2026-10-08 — Phase 4 complete (interactive problems & snippets)

**Interactive problems**
- `runner/interact.ts`: spawns solution + interactor with stdout/stdin cross-connected, records the
  transcript (merged per direction, 256 KB cap), kills both at TL × kill factor, gives the solution 1 s
  to exit after the interactor finishes. `RunnerService.interact` maps exit codes (0 AC, 1 WA, 2 PE→WA,
  3 judge failure, other = interactor crash) and spawn/TLE/OLE/RE cases. Route `POST /api/run/interact`.
- Problem meta `interactive` + `interactor`; turning interactive on creates the interactor from your
  library template (`interactor.cpp`/`.py`) or the built-in guess-the-number example.
- Web runner builds main + interactor (`build()`), runs tests/custom input through `interact`.
- UI: Interactive switch + interactor picker (Problem panel), conversation view (`tests/Transcript.tsx`)
  in Tests and Custom Input, judge message as the verdict reason.

**Snippets**
- `@cp-ide/shared` `parseSnippet` / `snippetPreview` (+ tests); snippets are inserted through Monaco's
  snippet controller (Tab stops, linked placeholders, auto-indent); completion items use
  `InsertAsSnippet` with description + preview.
- Palette `@` mode registered from the core plugin via the new `ctx.services.whenAvailable`.
- Library seeding is now per name (`.seeded` holds a JSON list; an old empty marker counts as the first
  release), so new built-ins (segtree, modint, dijkstra, sieve, dsu.py) appear once in existing installs.

**Verified** — browser: interactive problem end to end (2 AC with "correct after N queries", 1 WA with
the judge's reason, conversation rendered), palette `@seg` → insert → linked placeholder edits + Tab.
Tests: 25 passing (new: interactive AC/WA/TLE/no-flush deadlock/interactor crash/Python solution/
interactor creation, seeding upgrade, snippet parsing).

**Planning** — Playground phase (next) and LSP phase written up (PLAN.md, LSP_PLAN.md); stress tester
and custom checkers on hold.

## 2026-10-07 — Fix: editor suggestions offset from the cursor

dockview panel overlays use `transform: translate3d(0,0,0)` / `will-change: transform` /
`contain: layout paint`, which makes them the containing block for `position: fixed`. Monaco's
`fixedOverflowWidgets` positions widgets in viewport coordinates, so suggestions/hovers were offset
by the panel's position (and could be clipped). Both Monaco editors now pass
`overflowWidgetsDomNode: overflowWidgetsHost()` — a `.monaco-editor` container on <body>
(`plugins/core/src/editor/monaco.ts`). Verified: suggest widget left/top line up with the cursor.
Any future plugin that embeds Monaco in a panel should do the same.

## 2026-10-07 — Command palette module

- New `plugins/palette` replaces the palette that lived in the core plugin (`chrome/palette.ts` →
  only layout helpers remain, now `chrome/layouts.ts`). Command ids `workbench.quickOpen` (Ctrl+P) and
  `workbench.commandPalette` (Ctrl+Shift+P) are kept so user keybinding overrides still apply; new
  `palette.panels` (Ctrl+Alt+P), `palette.layouts`, `palette.gotoLine` (Ctrl+G).
- Plugin API: `ctx.overlays.register`, `ctx.services.provide/get`, `ctx.panels.isOpen`.
  `fuzzyMatch` moved to `@cp-ide/shared` so plugins can use it.
- The palette plugin's package exports its types (`@cp-ide/plugin-palette`) for consumers of the
  `palette` service.
- Verified in the browser: default mode (files + problems), `#` panels (opened Toolchain), `>` commands
  (ran "Mark as solved"), `:15:5` go to line, top-bar search box.

**Incident & guard** — a leftover `tsx watch` test server outlived its deleted temp `CP_IDE_HOME`,
restarted with default settings and wrote three test problems into the real `~/cp`. They were moved
to `~/cp/.trash` (`1791393167005-a-watermelon`, `1791393167157-b-two-arrays`,
`1791393167310-weird-algorithm`). The server now refuses to start when `CP_IDE_HOME` points to a
missing folder, and CLAUDE.md tells agents to run test servers with `start` (no watcher) and to
assert the problems root before writing.

## 2026-10-07 — Phase 3 complete

**Server**
- `services/library.ts`: templates/snippets as files under `~/.cp-ide/<kind>/`, seeded once (a
  `.seeded` marker keeps deleted defaults deleted). Routes `/api/library/:kind` (+ `create`, `rename`, `delete`).
- `ProblemsService.move / trash / restore` (+ routes `/api/problems/{move,trash,restore}`); emptied
  platform/contest folders are removed; folder renames retry on Windows EPERM/EBUSY.
- `services/watcher.ts`: recursive `fs.watch` on the problems root → `problems:changed` server event
  → SSE `/api/events` (`ServerEvent` in `packages/shared`). Re-watches when `problems.root` changes.
- `fs-utils.ts` `writeFileAtomic`: temp + rename with retries and an in-place fallback (fixes EPERM
  seen on Windows when a reader/antivirus touched `problem.json` during rename).
- Problem meta gained `compareMode` / `floatEpsilon`; exec requests accept `floatEpsilon`; create
  accepts `template`. New settings `templates.defaultCpp` / `templates.defaultPython`.

**Plugin API** — `ctx.library` (list/use/save/create/rename/remove), `workspace.renameProblem /
moveProblem / deleteProblem / restoreProblem`, `updateMeta(patch, id?)`, `WorkspaceState.problemsRoot`,
notify actions (`{ label, run }`), events `problems:changed` and `problem:reloaded`. Server plugins
get `ctx.library` and the `problems:changed` event.

**Web** — `core/server-events.ts` (EventSource + watchdog reconnect + resync after reconnect),
`reconcileFromDisk` in the workspace, `core/library.ts` store, ContextMenu in `packages/ui`.

**Core plugin** — explorer rewrite, `explorer/actions.ts`, Templates & Snippets panel, snippet insert
command + completion provider, New Problem template picker and "New problem here…", Problem panel
comparison settings and rename/move/delete buttons, new commands (`problems.*`, `snippets.insert`,
`library.open`, `editor.insertText`).

**Verified** — explorer filters/sort/recent and context menu (screenshots); move → rename → delete →
restore with the open problem following its new id; external edits (Git Bash, Node, PowerShell) reach
the open problem incl. new files and tests; recovery after an API server restart (watchdog);
template applied on create; snippet inserted at cursor; float tolerance override gives AC.
Tests: 17 passing (new: move/trash/restore, templates, library, watcher).

## 2026-10-07 — Vim mode polish

- Vim mode is shown as a coloured pill (NORMAL blue, INSERT green, VISUAL purple, REPLACE red) by
  subclassing monaco-vim's `StatusBar` (`plugins/core/src/editor/EditorPanel.tsx`).
- Editing-mode dropdown (Default / Vim) pinned to the right end of the editor's file tab bar, Zed-style;
  it writes the same `editor.vimMode` setting as the Settings panel.
- Window-resize behaviour confirmed fine by the user.

## 2026-10-07 — Phase 2 complete

**Plugin API additions** (`packages/plugin-api/src/web.ts`)
- `ctx.ui.quickPick / prompt / confirm` (shell renders them in `QuickInput.tsx`)
- `ctx.layout` presets: `registerPreset`, `applyPreset`, `saveCurrent`, `deleteSaved`, `listPresets`, `reset`
- `ctx.commands.list()` now returns effective keybindings (+ `defaultKeybinding`), `useList`,
  `setKeybinding`, `recordKeybinding`, `formatKeybinding`
- `ctx.workspace.createFile / renameFile / deleteFile / duplicateTest / moveTest`
- `ctx.runner.runCustom(input)` with `state.custom`
- `unwrap()` exported for plugins (typed Hono RPC calls that throw `{ error }` messages)
- Settings: new `record` descriptor type (+ `hidden`), `keybindings`, `editor.vimMode`

**Server** — `POST /api/problems/file/{create,delete,rename}`; renaming the main file updates
`mainFile` and language. `.ans` is an editable extension.

**New plugin** — `plugins/format` (server route spawns the formatter; settings shared by both halves;
wraps `workspace.save` for format-on-save).

**Core plugin** — command palette, quick open, layout commands/presets, Keyboard Shortcuts panel,
Custom Input panel, file tab bar (+ / F2 / double-click rename / ✕ or middle-click delete),
Vim mode, tests collapse/duplicate/move/import, width-aware panel headers (container queries).

**Web shell** — layout manager rewritten: presets, saved layouts, pinned side sizes re-applied after
window resizes, default sizes deferred when the dock is built while hidden. A Vite alias maps deep
`monaco-editor/esm/*` imports (needed by monaco-vim with Monaco 0.57's exports map).

**Verified** — palette + fuzzy filter, applying presets, custom input run, new/rename/delete file,
keybinding recording and override (old binding inert, new one runs), test move/duplicate/import,
formatter missing-binary message and success path (stub command), Vim mode status, default layout
sizes at 1600px. Server tests: 8 passing (incl. file operations). **Not verified live:** the
window-resize behaviour (the browser pane was hidden during that part of testing).

## 2026-10-07 — Bug fixes after first use

- Page could scroll: dockview parks hidden "always rendered" panels below the viewport. The shell
  (`html/body/#root`) and the dock container now clip overflow.
- New Problem → Platform/Group used `<datalist>`, which only lists options matching the current
  text. Replaced with a `Combobox` (`packages/ui`) that shows all options and filters while typing.
- UI font size only changed body text spacing because components size text in rem. The setting now
  sets the root font size (`uiFontSize × 16/12`), so text, controls and spacing scale together; fixed
  `text-[10px]/[11px]` classes became rem. Default is now 12 (= previous look).
- Added `docs/LIMITATIONS.md`; Competitive Companion moved to the last phase.

## 2026-10-07 — Phase 1 complete

**Built**
- Monorepo scaffold (pnpm + turbo), packages `shared`, `plugin-api`, `ui`; apps `server`, `web`.
- Hono API + RPC types; settings, problems and runner services; server plugin host.
- Web shell (top bar, dockview dock, status bar), core stores, web plugin host, keybindings, theming.
- `plugins/core` (explorer, editor, tests, output, problem, settings, toolbar & status items).
- `plugins/toolchain` (server route + panel + contributed setting + startup check).
- Tests: comparator unit tests; server integration tests (C++ AC/WA/RAN/cache/CE/TLE/RE,
  Python AC/RE/CE, problem CRUD, path safety).

**Verified manually in the browser (1440×900)**
- Open problem → edit → Ctrl+Enter: AC / WA (first mismatch highlighted) / RAN shown per test.
- Compile error: squiggle in editor, clickable `main.cpp:L:C` in Output, tests marked CE.
- Python problem via New Problem dialog; stderr shown separately; files autosaved to disk.
- Settings panel edits persist to `~/.cp-ide/settings.json`; light/dark switch applies to Monaco and dockview.
- Close panel / reopen via shortcut (Ctrl+J), View menu, Reset layout; toolchain panel via plugin RPC.
- `pnpm start` production build served by the Hono server (SPA fallback works).

**Known issues / limitations** — moved to [LIMITATIONS.md](LIMITATIONS.md).

**Next up** — Phase 2. Competitive Companion was moved to the final phase.
