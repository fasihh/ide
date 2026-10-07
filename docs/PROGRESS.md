# Progress log

Newest first. Update this when you finish a chunk of work: what changed, what was verified, what is
left. Phase checklists live in [PLAN.md](PLAN.md).

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
