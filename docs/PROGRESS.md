# Progress log

Newest first. Update this when you finish a chunk of work: what changed, what was verified, what is
left. Phase checklists live in [PLAN.md](PLAN.md).

## 2026-10-09 — Clearer message when a run is stopped

- Report: "Killed after 10022 ms" looked like a 10 s cap. It was the problem's own limit × "Kill after"
  (10), and the solution really never finished (infinite recursion at n = 1).
- TLE by kill now reads "Never finished: stopped after N ms (F× the L ms time limit). Look for an infinite
  loop or recursion; if it is just slow, raise this problem's time limit." (tests and interactive runs).

## 2026-10-09 — Per-file indentation; longer time limits; visible setting clamps

- Report: some files ignore the tab-size setting; a TLE after 10 s could not be raised in Settings.
- Indentation: Monaco detects each file's indentation, and setting changes never reached open files.
  Now indentation is per file (`packages/editor/src/indentation.ts`): defaults applied once per file
  (`ensureIndentation`), re-applied to all files when `editor.tabSize` / new `editor.detectIndentation`
  change, and a per-file override. Core status bar item "Spaces: N" / "Tabs: N" + command
  `editor.changeIndentation`: indent using spaces/tabs (new lines), re-indent file with spaces/tabs
  (rewrites existing lines; `reindent()` in `@cp-ide/shared`, tested — Monaco's own commands only swap
  tabs/spaces), detect from content. `activeEditor()` / `onDidChangeActiveEditor` exported from
  `@cp-ide/editor` (last focused editor).
- Time limit: `runner.timeLimitMs` max 60 s → 1 hour (the user's 10 s cap was "Kill after ×" at its
  max of 10). Settings number fields now say "Maximum is N" / "Minimum is N" when they clamp.
- Verified (temp home, default tab size 2): 4-space file detected as Spaces: 4; re-indent to 2 spaces
  rewrote every level and synced the buffer; settings change re-applied (8, back to detect → 2); API
  accepts 120 s and rejects > 1 h with a message; typing 20 into "Kill after" → 10 + "Maximum is 10".
- Dev note: adding a workspace dependency needs `pnpm install` and a Vite restart (it failed to resolve
  `@cp-ide/shared` from `@cp-ide/editor` until restarted).

## 2026-10-09 — Phase 8: Competitive Companion import

- `plugins/competitive-companion`:
  - `payload.ts` — zod schema for the extension's JSON, `platformOf` (URL host → known names, else the
    group's "Site - " prefix), `contestOf`, `toCreateInput`, `sameTest` (CRLF / trailing-space tolerant).
  - `receiver.ts` — `CompanionReceiver`: HTTP on 127.0.0.1, POST JSON only, 5 MB cap, answers at once;
    refuses web-page origins (extension origins or none allowed); status stopped / listening / error
    (EADDRINUSE → readable message); reports the bound port.
  - `importer.ts` — `importProblem` (create with samples, interactive → `updateMeta({interactive})`;
    existing URL → add only new samples, keep code) and `BatchCollector` (one announcement per contest,
    flush when complete or 3 s after the last problem).
  - `server.ts` — imports serialised; listener restarts on `competitive-companion.port` change and is
    disposed with the plugin; `GET /status`. State per activation in a `WeakMap` keyed by the context.
  - `web.tsx` — status bar item (quiet when listening, red on error), notifications with Open, opens the
    imported problem (problem A for a contest; `competitive-companion.openOnImport`).
  - Default port 10043 (extension built-in; leaves CPH's 27121 free).
- Core seam: server `ctx.broadcast(payload)` → `plugin:broadcast` → SSE `{ type: "plugin" }` → web
  `ctx.serverEvents.on(handler)` (scoped to the plugin, disposed with it).
- Tests: payload (4), receiver over real HTTP (origins, 405/400, port in use, dispose), importer + batches (3).
- E2E (temp home, port 27199 to avoid the user's instance, requests shaped like the extension's):
  single problem → created with limits/URL/sample, opened, "Imported A. Watermelon"; contest of 3 sent in
  parallel → one "Imported 3 problems", interactive C got `interactor.cpp`; re-import → "Added 1 test"
  (CRLF duplicate ignored, code kept); port change live; plugin off → port closed, status 404, item gone;
  port taken → red item with message.

## 2026-10-09 — Fix: plugin switches vanished while toggling

- Report: pressing a plugin switch in Settings made switches disappear.
- Cause: `reconcilePlugins()` emptied the shared plugin list and refilled it one entry at a time, awaiting
  each activation; the Settings panel re-rendered mid-way and kept showing the partial list (the list was
  not reactive).
- Fix: plugin infos live in a store, built completely and replaced in one step before (de)activating;
  `ctx.plugins.useList()` (new) lets the Settings panel follow it. Removed the unused `pluginInfos()`.
- Verified with real clicks: basedpyright off, Playground off, both on — all 8 rows stay, states correct.

## 2026-10-09 — Plugins turn on and off live (server and web)

- Report: turning off the language-server plugins left the servers running until a cold start;
  turning the Playground back on failed with "Unexpected token '<'… not valid JSON".
- Cause: both hosts read `plugins.disabled` only at startup. The Settings "Reload" re-ran web halves,
  but server halves stayed as they were at server start — routes of a plugin enabled later were never
  mounted, so requests fell through to the web app's HTML.
- Server (`apps/server/src/plugin-host.ts`): discover once, then `reconcile()` on every
  `plugins.disabled` change (serialised). Each plugin gets a scoped context — `websocket`, `on`,
  `languageServers.register`, `runner.registerLauncher` are collected with `setup`'s result and
  disposed on deactivate. Routes go through one dispatcher (`/api/plugins/:id/*`) that answers a JSON
  404 while a plugin is off. Emits `plugins:changed` → SSE `plugins-changed`.
- Web: `reconcilePlugins()` (startup + on `plugins-changed`, i.e. after the server caught up) activates /
  disposes plugin stores; `refreshLanguageServers()` disposes sessions of removed servers and attaches
  editors to new ones (`assign(model)` is the one place deciding a model's session); the layout closes
  panels whose registration disappears; the registry stacks same-id registrations so disposing one
  restores the previous (format plugin's `workspace.save` wrapper → core's save comes back).
- Settings: plugin switches apply immediately (no "Reload" prompt).
- Tests: `plugin-host.test.ts` (routes follow the plugin's state; language server unregistered).
  Browser (temp home): basedpyright off → process gone, status item + markers + settings section gone;
  Playground off → panel closed, 8 commands and New entry gone, API JSON 404; on → all back, files load,
  no error toast; format off → `workspace.save` owned by core, on → format again.

## 2026-10-09 — Fix: basedpyright ignored the type-checking setting

- Report: many type warnings even on "basic", and "off" changed nothing.
- Cause: basedpyright requests the `basedpyright` configuration section and reads `analysis` inside it;
  we answered under a flat `"basedpyright.analysis"` key, so it always fell back to its default
  (`recommended`). Probe on torch code: flat basic/off → 10 diagnostics; nested basic → 1, off → 0.
- Fix: `LanguageClient` answers `workspace/configuration` by dotted path into a nested settings tree
  (`configurationSection`, VS Code semantics); the basedpyright plugin sends
  `{ python: { pythonPath }, basedpyright: { analysis } }`. Tests updated.
- Verified in the app: switching the setting re-applies without reload (recommended 10 → off 0 →
  basic 1 warnings on the same file).

## 2026-10-09 — Palette sweep, "New" entries from plugins, explorer header redesign

- Report: creating a playground file from the palette "didn't work". Cause: the file was created but
  the Playground panel stayed behind the Code tab. `newPlaygroundFile` now opens `playground.editor`.
- Palette sweep (temp home, all 66 commands run through the registry like the palette does, dialogs
  recorded and dismissed): everything works. Fixed the stale "Toggle interactive problem" hint in
  `problems.openInteractor`. Unverified in the hidden test pane only: `problems.copyPath` (clipboard
  needs a focused page).
- Plugin API: `ctx.newItems` (`NewItemContribution`: label, description, icon, command, order). Core
  registers Scratch problem / Problem…; the playground registers "Playground file". Rendered by
  `chrome/NewItems.tsx`: top bar New menu, explorer + menu, cards on the empty editor (shortcuts come
  from the commands — the old hard-coded "Alt+N" labels are gone).
- New Problem dialog: Mode field (`ModePicker`, shared with the Problem panel's `ModeSegmented`);
  non-standard modes are applied with `setMode` after creating.
- Explorer header (feedback: cluttered): one row — search with a view-options button inside it (status
  with counts, tags, sort, refresh; badge = active filters) and a + New menu. Active filters show as
  removable chips under the search, only while set. Constants moved to `explorer/view.ts`; toolbar in
  `explorer/ExplorerToolbar.tsx`.
- Verified in the browser: palette → New playground file → Playground in front with the new file;
  New menu and explorer + list all three entries; dialog with Playground mode → `runMode: playground`;
  palette → Save playground file as problem → Python problem in Playground mode, opened in Code.

## 2026-10-08 — Phase 6 L4 complete (rename, LSP formatting, inlay hints, idle shutdown, clangd download)

- Rename: client `rename.prepareSupport`; `registerRenameProvider` (prepareRename → placeholder); edits for
  other documents are refused with a message (`otherDocuments`, `editsForDocument` in convert.ts). Core
  command `editor.renameSymbol` (F2, `when` a code editor has focus — `focusedEditor()` in
  `@cp-ide/editor`) wins over file rename. Found in testing: Enter/Escape in the rename box never reached
  Monaco (box lives in the `<body>` overflow host) → `monaco.ts` forwards them to the last focused editor.
- Formatting: `LanguageClient.format(uri, text, options)` + pure `applyTextEdits` (tested, CRLF / clamping);
  `ctx.languageServers.format(path)`; format plugin settings `format.cppEngine` / `format.pythonEngine`
  (command | languageServer, falls back to the command); clangd `--fallback-style` from
  `lsp-clangd.formatStyle` (default Google, matching the clang-format default).
- Inlay hints: client `inlayHint` + `workspace.inlayHint.refreshSupport`; `registerInlayHintsProvider`,
  refreshed on `workspace/inlayHint/refresh` and after diagnostics; core setting `editor.inlayHints`.
- Idle shutdown: core setting `editor.languageServerIdleMinutes` (default 10); `LanguageClient.onRequest`
  activity hook; session `touch()` / `wake()` (edit or editor focus); idle stop keeps markers.
- clangd download: generic `action` on unavailable servers (shared `LanguageServerAction`, status bar runs
  it); `lsp-clangd` `ClangdInstaller` (GitHub latest release → platform zip → `fflate` → plugin data dir,
  zip-slip guarded, numeric version sort) + routes `GET /release`, `POST /install`; resolver order:
  configured command → PATH → downloaded copy. Web command shows version and size and asks first.
- Tests: lsp-client edits (3); clangd installer (3, fake GitHub + generated zips) and resolver (now 4).
- Browser E2E (temp home): inlay hints `first:`/`second:`/`: vector<int>`; F2 → rename `total`→`answer`
  (both uses, buffer synced); Shift+Alt+F via clangd → Google style without clang-format; idle 1 min →
  clangd exited ~68 s after load, clicking the editor restarted it; missing clangd → warning item → dialog
  "Download clangd 23.1.0? clangd-windows-23.1.0.zip (30 MB)…" (cancelled — no download performed).
- Testing notes: in the hidden browser pane, Monaco cannot move focus into the rename box (animation
  frames are paused), and modules imported from the console may be separate instances from the app's.

## 2026-10-08 — `@cp-ide/cache` + cached member completions

- Feedback: after the stale-text fix, every `np.` still waited ~0.8 s (basedpyright recomputes types
  for all 658 numpy members on each request after an edit; settings like `typeCheckingMode: off` or
  `autoImportCompletions: false` did not help — measured with a scratch probe).
- New core package `packages/cache` (no deps, server + browser): `LruCache`, `SwrCache`
  (stale-while-revalidate: hit → returned at once and refreshed in the background; miss → awaited;
  concurrent loads deduped; failed / `shouldCache`-rejected loads not stored; `clear()` ignores late
  results). 4 tests.
- `@cp-ide/lsp-client` `completion.ts`: `memberCompletionKeys` (receiver + typed prefix, exact key first
  then shorter prefixes), `rebaseCompletion` (shift edits on the request line to the cursor),
  `withoutEditRanges` (superset fallback). 3 tests.
- `@cp-ide/editor` `registerLanguageFeatures`: member completions through an `SwrCache` (300 entries,
  per client, cleared on disconnect); loads are not tied to Monaco's cancellation token so results typed
  past are still stored.
- Browser timings (typing → list visible, numpy): first `np.` 2.7 s (cold), repeats ~150 ms, `np.z` /
  `np.ze` 0–20 ms. C++: cached `v.` on another line at a deeper indent inserted `push_back` at the right
  place (rebased edits).

## 2026-10-08 — Fix: completion after "." used stale text

- Report: `np.` offered nothing useful (looked like basedpyright missing global libraries).
- Investigation (scratch LSP probe driving basedpyright like the editor): imports resolve fine —
  `pythonPath` is applied (`Setting pythonPath … c:\Python312\python.exe`), torch/numpy/pandas resolve,
  only uninstalled packages are unresolved. Real cause: document sync was debounced 150 ms, so the
  completion request triggered by "." reached the server before the edit adding the "."; the server
  completed `np` at module scope (199 globals: `print`, `range`…) instead of numpy's 658 members.
  Affected clangd the same way.
- Fix: `core/language-session.ts` sends `didChange` synchronously on every model change (full text).
  Verified in the browser: typing `np.` without pausing lists numpy members; `np.zer` → `zeros`,
  `zeros_like`, `trim_zeros`.
- Measured basedpyright latency (numpy): first member completion ~2 s (cold), unchanged-file repeats
  ~20 ms, each re-request after an edit ~0.7–0.9 s. basedpyright marks the first list incomplete on
  purpose (it re-asks once with `TriggerForIncompleteCompletions`, then the list is complete and
  Monaco filters locally) — so the first letter typed after "." waits ~1 s. Logged in LIMITATIONS.

## 2026-10-08 — Phase 6 L1–L3: language servers (core) + clangd / basedpyright plugins

- Request: LSP registration in core, each LSP as a plugin; installs must work in a fresh environment
  (no tool-specific install lookups). Design in `docs/LSP_PLAN.md` → "As built".
- Plugin API: server `ctx.languageServers.register(LanguageServerContribution)`; web
  `ctx.languageServers` (`list`, `useStates`, `restart`); shared `LanguageServerInfo`, `splitArgs`
  (deduplicated from the runner and the format plugin).
- Server: `apps/server/src/lsp/{framing,session,host}.ts`, `GET /api/lsp/servers`, `WS /api/lsp?server=`
  (SocketRouter handlers now receive the URL). Web: `core/language-servers.ts`, `core/language-session.ts`.
  Packages: new `@cp-ide/lsp-client`; `@cp-ide/editor` gained `registerLanguageFeatures`, `toMarker`,
  `canonicalUri`, `fileModelPath`. Editor/Playground models use real file URIs; Library uses `library:`.
- Plugins: `lsp-clangd` (PATH or `lsp-clangd.command`; fallbackFlags + `--target=` from `g++ -dumpmachine`,
  verified with `clangd --check` on MinGW), `lsp-basedpyright` (npm dep, `pythonPath` via
  `sys.executable`, `lsp-basedpyright.typeCheckingMode` default `basic`). Core status bar item + command
  "Restart language servers".
- Tests: lsp-client (3), server LSP framing/host with a fake stdio server (4), clangd resolve (3),
  basedpyright resolve (3). Browser E2E (temp home, clangd via a test-only `lsp-clangd.command`):
  C++ diagnostics as you type, `vector` member completion + snippet insertion, hover, F12; Python type
  error diagnostics + `str` completions; Playground file attached; `cpp.standard` change restarts clangd
  (new PID); missing clangd → warning item, fixing the setting recovers without reopening files.
- Answered: `clang-format` failed because the pip package's console script
  (`C:\Python312\Scripts\clang-format.exe`) was never created (RECORD lists no scripts, no INSTALLER file).

## 2026-10-08 — Warm start refactored into a plugin; code principles doc

- Feedback: the first version was wedged into `RunnerService.start` (extension sniffing, Python embedded
  in a TS string, lazy global exit hook, control data on stdin). Replaced by:
  - Plugin API: `Program` (discriminated union recorded at compile time), `LaunchOptions`,
    `ProcessLauncher`, `RunnerService.registerLauncher` (live sessions only; first non-null child wins,
    else direct spawn). `PluginRoutes` moved to `common.ts` (structural) so the web half has no Node types.
  - Runner: artifacts carry a `Program`; one `commandLine(program)` builds every direct command line.
    It contains nothing Python-warm specific. `warm-python.ts` deleted; `interact.ts` type renamed `CommandLine`.
  - `plugins/python-warm`: `launcher.ts` (`WarmPythonLauncher`, injected `bootstrap`/`enabled`/`idleMs`),
    `warm_bootstrap.py` (real file; script path on **fd 3**, so stdin is user-only — verified on Windows),
    `settings.ts` (`python-warm.enabled`, replaces core `python.warmStart`), `server.ts` returns a
    `DisposableStore`; `settings:changed` clears the standby immediately.
  - Plugin host keeps `setup()` disposables and disposes them on exit.
- Tests: plugin `launcher.test.ts` (6, real python) + `test_warm_bootstrap.py` (4, unittest, run by the
  plugin's `pnpm test`); server seam test with fake launchers. E2E through the server + playground socket:
  torch 7.2 s cold, then 0.73 / 0.88 s. Killing the server makes the standby exit by itself (fd 3 EOF).
- `.claude/rules/code-principles.md`: strict modularity / clean-code rules with a done-checklist
  (pointer in `CLAUDE.md`). `__pycache__` added to `.gitignore`.

## 2026-10-08 — Python warm start for terminal runs (first version, superseded above)

- Feedback: every Playground run of a torch script paid the full import time. Measured: `.pyc` files
  were all present; `import torch` alone costs ~2.8 s per fresh process, so a warm process was needed.
- `apps/server/src/runner/warm-python.ts`: live Python runs go through a bootstrap
  (`~/.cp-ide/cache/cp-ide-warm.py`). After a run exits, a standby process imports the script's
  leading import block (ast, stops at the first other statement) and waits for the next script path on
  stdin (read byte by byte so user stdin is untouched), then runs it with `runpy` as `__main__` and
  trims bootstrap frames from tracebacks. Fresh process per run — no state carries over. Idle standby
  is killed after 15 min. Only `runner.start` (terminal runs) uses it; tests stay cold.
- Setting `python.warmStart` (default on). Bench (real torch): run 1 2384 ms, then 652 / 534 / 479 ms.
- Server test added (preload reuse, `__main__`, traceback trimming, raw stdin, setting off).

## 2026-10-08 — One Run button, per-problem Playground mode

- Feedback: two Run buttons in the Playground, and problems saved from the playground ran tests.
- Plugin API: `ctx.run` run targets (`register({ id, label, icon, priority, applies, run, useBusy, stop })`,
  `current`, `useCurrent`, `runCurrent`) and `ctx.panels.active()/useActive()` (dockview
  `onDidActivePanelChange`). Core registers `core.tests` (priority 0); the playground registers
  `playground.file` (20, Playground panel active) and `playground.problem` (10, problem `runMode`).
- `run.primary` (Ctrl+Enter) runs the current target; `runner.runAll` no longer has a default key
  (users who rebound it keep their binding). The top Run button shows the target's icon/label and
  becomes Stop while it runs. The Playground panel's own Run button was removed.
- Problem meta `runMode: "tests" | "playground"` (+ create input). Mode UI: `problem/ModeControl.tsx`
  — `ModeChip` (Tests header, replaces the interactive chip) and `ModeSegmented` (Problem panel);
  commands `problems.mode.<standard|interactive|playground>` replace `problems.toggleInteractive`.
- Verified: playground-mode problem → Ctrl+Enter runs in the terminal (no tests run); standard → tests
  (AC); Playground panel active → playground file / Stop while busy; save-as-problem stores
  `runMode: playground`; Mode control rendered in the Problem panel.

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
