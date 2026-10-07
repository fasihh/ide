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

## Phase 2 — Layout & editing polish ⬜

- ⬜ Command palette (Ctrl+Shift+P) over `ctx.commands.list()`; quick open problems (Ctrl+P)
- ⬜ Layout presets (Focus = editor+tests, Debug = all) as commands; save custom presets
- ⬜ Keep the editor column absorbing window resizes (dockview has no group priority — investigate
  constraints / custom resize handling)
- ⬜ User keybinding overrides (setting `keybindings` map: command id → binding)
- ⬜ Vim mode (`monaco-vim`), format document (clang-format / black, server-side)
- ⬜ Create / rename / delete extra files in a problem (e.g. `brute.py`, `gen.py`) from the editor tabs
- ⬜ Tests: collapse/expand all, reorder, duplicate, import from clipboard/files (`*.in`/`*.out`)
- ⬜ Run with custom stdin without creating a test (scratch input box)

## Phase 3 — Problem management ⬜

- ⬜ Explorer: sort (recent / name), filter by status & tag, "recent problems" section
- ⬜ Rename / move / delete problems (delete moves to `root/.trash`)
- ⬜ Watch the problems root for external changes (fs.watch) and push updates (SSE/WebSocket)
- ⬜ Template manager: multiple templates per language, pick on create; snippets
- ⬜ Per-problem compare mode / epsilon override

## Phase 4 — Power tools (each a plugin) ⬜

- ⬜ Stress tester: generator + brute + solution in a loop until outputs differ; save the failing case as a test
- ⬜ Custom checker (testlib-style `checker.cpp`) for multi-answer problems
- ⬜ Interactive problems (run solution against an interactor)
- ⬜ Snippet library (dsu, segtree, modint…) with insert command

## Phase 5 — Nice to have ⬜

- ⬜ Stats dashboard (solved per platform/tag/day)
- ⬜ Contest mode with timer
- ⬜ C++ IntelliSense via clangd (monaco-languageclient over WebSocket)
- ⬜ "Copy & open submit page" helper
- ⬜ Memory limit enforcement (Windows Job Objects / Linux prlimit) and peak memory reporting
- ⬜ Desktop wrapper (Tauri) or PWA install

## Phase 6 — Competitive Companion import ⬜ (last, by request)

Implement as a plugin (`plugins/companion`) — server half starts its own HTTP listener.
- ⬜ Listen on a configurable port (default **10043**; 27121 is CPH's and clashes when VS Code runs)
- ⬜ Parse payload (`name`, `group`, `url`, `tests`, `timeLimit`, `memoryLimit`, `interactive`, `batch`)
- ⬜ Map `group` ("Codeforces - Educational Round 170") → platform + contest
- ⬜ Create the problem, notify the web app (SSE event) and auto-open it; batch = whole contest
