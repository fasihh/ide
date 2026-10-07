# cp-ide — Plan & Phases

A local, browser-based IDE for competitive programming in C++ and Python. Replaces "open VS Code
+ CPH" with a page that starts instantly, keeps every problem organised on disk, and puts code,
custom tests and verdicts side by side in a LeetCode-style resizable/closable panel layout.

Status legend: ✅ done · 🟡 partial · ⬜ not started

---

## Goals

1. **Start a problem from anywhere in seconds** — scratch problem (Alt+N), manual problem, or
   one-click import from the judge page (Competitive Companion, like CPH — scheduled last).
2. **Tight test loop** — custom tests, run all / run one, per-test verdict (AC/WA/TLE/RE/OLE/CE),
   diff of the first mismatch, stderr kept separate.
3. **Organised problems** — plain folders `root/platform/contest/problem`, status, tags, notes, search.
4. **Adjustable workspace** — every panel resizable, closable, re-openable, draggable; layout persists.
5. **Modular** — every tool is a plugin (web and/or server half) built on a public API, so new tools
   can be added any time without touching the core. The built-in UI itself is a plugin.
6. **Global settings** — fonts, theme, problems root, limits, compiler flags… generated UI,
   persisted to `~/.cp-ide/settings.json`, extensible by plugins.

## Stack

- Monorepo: **pnpm workspaces + Turborepo**
- Backend: **Hono** on Node (`@hono/node-server`), **Hono RPC** for end-to-end types, zod validation
- Frontend: **React 19 + Vite**, Tailwind v4, shadcn-style components (`packages/ui`, Radix),
  **dockview** for the panel layout, **Monaco** (bundled locally) for the editor, zustand for state

---

## Phase 1 — Foundation & core loop ✅

- ✅ Turborepo/pnpm monorepo (`apps/server`, `apps/web`, `packages/{shared,plugin-api,ui}`, `plugins/*`)
- ✅ Hono API with RPC types consumed by the web client (`AppType`), zod-validated, uniform `{ error }` responses
- ✅ Plugin system
  - ✅ Web plugins: panels, commands + keybindings, toolbar/status bar items, settings contributions,
    events, workspace/runner/theme services, typed `ctx.rpc()` to the plugin's server half
  - ✅ Server plugins: typed Hono routes at `/api/plugins/<id>`, hooks, core services, private data dir
  - ✅ Discovery by convention (`plugins/<name>/src/{web.tsx,server.ts}`), enable/disable in settings
  - ✅ Core UI implemented as the `core` plugin; `toolchain` plugin as a full-stack example
- ✅ Global settings: descriptor-based (core + plugin), validated server side, generated settings panel
- ✅ Problem storage on disk (`problem.json`, `tests.json`, `main.cpp|py`), templates in `~/.cp-ide/templates`
- ✅ Runner: C++ (g++, configurable std/flags/stack size) and Python; content-hash compile cache;
  parallel tests; TL + kill factor; output limit; token/float/exact comparison; Windows exit-code
  explanations (stack overflow, access violation…); antivirus warm-up run
- ✅ Editor panel (Monaco, multi-file tabs, compiler diagnostics as squiggles, autosave)
- ✅ Tests panel (add/edit/delete/disable, run one/all, verdict badges, diff, stderr, "use as expected")
- ✅ Output panel (compile log with clickable `file:line` links)
- ✅ Explorer (platform → contest tree, filter, status dots), New problem dialog, scratch problems
- ✅ Problem panel (name, URL, status, language, TL/ML, tags, notes)
- ✅ dockview layout: resizable/closable/draggable panels, View menu, persisted layout, reset
- ✅ Light/dark/system theme, UI & editor fonts
- ✅ Tests: comparator unit tests, server integration tests against real g++/python

## Phase 2 — Layout & editing polish ✅

- ✅ Command palette (Ctrl+Shift+P) over all commands (recently used first, fuzzy match); quick open problems (Ctrl+P)
- ✅ Layout presets: Default / Focus / Zen / Everything (Ctrl+Alt+1–4), plugin-registered presets, save/apply/delete custom layouts
- ✅ Editor column absorbs window resizes: side/bottom group sizes are pinned and re-applied after resizes
  (dockview has no group priority)
- ✅ User keybinding overrides (`keybindings` setting) + Keyboard Shortcuts panel (record keys, conflicts, reset)
- ✅ Vim mode (`monaco-vim`, `editor.vimMode`) with status line
- ✅ Format document (Shift+Alt+F) as the `format` plugin — clang-format / black, configurable commands, optional format on save
- ✅ Create / rename (F2, double-click) / delete extra files in a problem from the editor tab bar; new .cpp/.py start from the template
- ✅ Tests: collapse/expand all, move up/down, duplicate, import `*.in` + `*.out`/`*.ans` files
- ✅ Custom Input panel: run on scratch stdin without creating a test (Ctrl+Shift+Enter), save it as a test

## Phase 3 — Problem management ✅

- ✅ Explorer: sort (recently changed / name / status), status filter chips with counts, tag filter,
  "Recent" section, solved/total per platform and contest, view state remembered
- ✅ Rename / move / delete problems (right-click menu, Problem panel, palette). The folder follows
  platform/contest/name; delete moves to `<root>/.trash` with an Undo toast; rename a whole contest
- ✅ Live sync: the server watches the problems root (`fs.watch`, recursive) and pushes changes over SSE
  (`/api/events`); the list refreshes and the open problem reloads (unsaved edits are kept)
- ✅ Template & snippet library (`~/.cp-ide/templates`, `~/.cp-ide/snippets`) with a manager panel,
  default template per language, template picker on New Problem; snippets via Ctrl+Alt+I or editor
  autocomplete
- ✅ Per-problem output comparison mode and float tolerance

## Phase 3.5 — Command palette module ✅

- ✅ `plugins/palette`: one palette with modes — no prefix: problems + files of the open problem,
  `>` commands (recently used first), `#` panels (open/focus/close any panel), `!` layouts,
  `:` go to line, `?` help
- ✅ Top-bar search box ("Search problems, panels, commands…") as the visible entry point
- ✅ Extensible: other plugins add modes through the `palette` service (`PaletteService.registerProvider`)
- ✅ Plugin API: `ctx.overlays` (app-root components) and `ctx.services` (plugin-to-plugin services)

## Phase 4 — Interactive problems & snippets ✅

- ✅ Interactive problems: per-problem `interactive` flag + interactor file (created from a C++ or Python
  template, or your own `interactor.cpp`/`.py` in the template library). The runner cross-connects the
  solution and interactor (testlib convention: `interactor input output answer`, exit 0 = AC, 1 = WA,
  2 = PE, 3 = judge failure), records the conversation, and reports TLE/RE/OLE for either side
- ✅ Tests panel and Custom Input show the conversation (judge ↔ you) and the judge's message;
  Problem panel has the Interactive switch and interactor picker
- ✅ Snippets: Monaco snippet syntax (`${1:name}` placeholders, Tab between them, `$0`), optional
  `// @description` / `// @prefix` header, descriptions in autocomplete and the palette (`@` mode),
  new built-ins (segtree, modint, dijkstra, sieve, dsu.py); new defaults reach existing installs once

## Phase 5 — Playground ✅

- ✅ `plugins/playground`: Playground panel (file tabs, Run/Stop, actions) + Terminal panel (xterm.js)
  where you type input while the program runs; "Playground" layout preset; Alt+G opens it
- ✅ Streaming runs over a WebSocket (`/api/plugins/playground/run`): compile (cached), live
  stdout/stderr, stdin lines, Ctrl+D = EOF, Ctrl+C = stop, exit code / time / crash explanation;
  safety time limit (`playground.maxRunSeconds`)
- ✅ Files saved (autosave + Ctrl+S) in `playground.folder` (default `~/.cp-ide/plugins/playground`);
  new / rename / delete, "Save as problem…", "Download file"
- ✅ "Run problem in terminal" command for the open problem's main file
- ✅ One context-aware Run (top bar / Ctrl+Enter) via run targets: playground file while the Playground
  panel is active, problems in **Playground mode** in the terminal, tests otherwise
- ✅ Per-problem mode: Standard / Interactive / Playground (Tests header chip, Problem panel, palette);
  "Save as problem" creates Playground-mode problems
- ✅ Platform: WebSocket endpoints for server plugins (`ctx.websocket`, local-origin check),
  `runner.start` live process sessions, keybinding `when` conditions (Ctrl+Enter / Ctrl+S act on the
  playground while it has focus), shared `@cp-ide/editor` package (`CodeEditor` with settings, theme, Vim)
- Programs see pipes, not a TTY: C++ prompts appear when flushed (`endl`/`flush`, or reading from
  `cin` while it is tied to `cout`); Python runs unbuffered. A real PTY (node-pty) could come later.

## Phase 6 — Language intelligence (LSP) ⬜

VS Code-level completions, hover, signature help, diagnostics as you type and navigation via clangd
(C++) and basedpyright (Python). Full design: [LSP_PLAN.md](LSP_PLAN.md).

## Phase 7 — Nice to have ⬜

- ⬜ Stats dashboard (solved per platform/tag/day)
- ⬜ Contest mode with timer
- ⬜ "Copy & open submit page" helper
- ⬜ Memory limit enforcement (Windows Job Objects / Linux prlimit) and peak memory reporting
- ⬜ Desktop wrapper (Tauri) or PWA install

## On hold

- ⏸ Stress tester (generator + brute + solution loop, save failing case as a test)
- ⏸ Custom checkers (testlib-style `checker.cpp` for multi-answer problems)

## Phase 8 — Competitive Companion import ⬜ (last, by request)

Implement as a plugin (`plugins/companion`) — server half starts its own HTTP listener.
- ⬜ Listen on a configurable port (default **10043**; 27121 is CPH's and clashes when VS Code runs)
- ⬜ Parse payload (`name`, `group`, `url`, `tests`, `timeLimit`, `memoryLimit`, `interactive`, `batch`)
- ⬜ Map `group` ("Codeforces - Educational Round 170") → platform + contest
- ⬜ Create the problem, notify the web app (SSE event) and auto-open it; batch = whole contest
