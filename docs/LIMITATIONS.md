# Known limitations & issues

Keep this current: add an entry when you knowingly ship a limitation, remove it (and note the fix in
PROGRESS.md) when it is resolved. Planned fixes reference the phase in [PLAN.md](PLAN.md).

## Runner

| Limitation | Notes / planned fix |
|---|---|
| No memory limit and no peak-memory reporting | Needs Windows Job Objects / Linux prlimit (Phase 5) |
| Times are wall clock and include process start (~10–30 ms on Windows) | Good enough for spotting TLE; CPU time measurement would need native help |
| First run of a fresh `.exe` is slow on Windows (antivirus scan) | Mitigated by a warm-up launch after compiling. Adding `~/.cp-ide/cache` to Defender exclusions removes it entirely |
| Interactive runs measure wall time from start until the solution exits (judge time included) | Fine for spotting TLE |
| No testlib.h bundled — interactors using it need the header on the include path | Plain C++/Python interactors (the templates) work as is |
| Only token / float / exact comparison; no custom checkers | On hold (testlib-style checker) |
| Compile cache (`~/.cp-ide/cache`) is never pruned | Safe to delete manually any time |

## Editor

| Limitation | Notes / planned fix |
|---|---|
| No C++/Python IntelliSense (syntax highlighting, word + snippet completion only) | LSP phase — see LSP_PLAN.md |
| Compiler squiggles disappear on reload | Re-run to get them back |
| Formatting needs `clang-format` / `black` installed (not bundled) | `pip install clang-format black`, or point Settings → Formatting at your own command |
| Saved layouts live in browser localStorage (per browser profile), not in settings.json | Could move to the server later |
| Snippets use Monaco snippet syntax, so a literal `$` must be written `\$` | Documented in the Templates & Snippets panel |

## Language servers

| Limitation | Notes / planned fix |
|---|---|
| clangd is not bundled (native binary) | Install it so `clangd` is on PATH, or set Settings → C++ language server; basedpyright is bundled |
| Go to definition / references only show locations in files open in the editor (not system headers like `bits/stdc++.h`) | Hover still shows the declaration; opening read-only header models is possible later |
| One language server process per browser tab | Fine for a local single-user IDE |
| Settings changed outside the app (editing `settings.json`, another tab) do not re-check a failed server | Click the server in the status bar, or run "Restart language servers" |
| No rename, LSP formatting or inlay hints yet | Phase 6 L4 |
| The first member list for a big library (numpy, torch) after the server starts takes ~2–3 s | Repeats come from the completion cache (~150 ms; letters after the dot ~10 ms) |
| A cached member list is shown once before its background refresh lands, so right after redefining a name (e.g. `np = something_else`) the old members can appear one time | The refresh replaces it for the next request |

## Layout & UI

| Limitation | Notes / planned fix |
|---|---|
| On window resize, side panel sizes are re-applied after dockview's proportional resize (possible brief jump) | dockview has no per-group priority. A layout saved in a much smaller window may still need View → Reset layout |
| Some shortcuts are reserved by the browser (Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Shift+N) and can't be bound | Pick another combo in Keyboard Shortcuts |
| No chord keybindings (e.g. Ctrl+K Ctrl+S) | Single combos only |
| Global shortcuts win over Vim keys (e.g. Ctrl+B toggles the explorer instead of paging up) | Rebind or unbind the global shortcut in Keyboard Shortcuts |
| Enabling/disabling a plugin needs a page reload | No hot deactivation yet |

## Playground

| Limitation | Notes / planned fix |
|---|---|
| Programs run on pipes, not a real terminal: no colours/`isatty`, C++ output shows only when flushed | Use `endl`/`flush` for prompts (or keep `cin` tied to `cout`); a PTY via node-pty could come later |
| Input is line-based (sent on Enter); no raw key-by-key input | Fine for typical console programs |
| One run at a time per terminal | Starting a new run stops the previous one |
| Python warm start (`python-warm.enabled`) imports the script's leading import block *before* your code runs | Code placed before the imports (e.g. setting `os.environ[...]`) stops preloading at that line, so it still works; turn the setting off if a library must not be pre-imported |
| A warm standby process keeps its imports in memory (torch: a few hundred MB) for up to 15 min after the last run | Turn off `python-warm.enabled` to free it; tests always use fresh processes |
| A standby is reused only for the same interpreter, flags and working folder; environment-variable differences between runs are not detected | Runs from the IDE all use the same environment |

## Problems & storage

| Limitation | Notes / planned fix |
|---|---|
| If a file changes on disk while it has unsaved edits in the app, the app keeps your edits (no merge prompt) | Saving overwrites the external change |
| Trash (`<root>/.trash`) is never emptied automatically; restore is only offered right after deleting (Undo) | Delete or restore folders there by hand |
| Live sync relies on recursive `fs.watch` (Windows/macOS, Linux on recent Node); network drives may not report changes | Use the explorer's refresh button |
| No import from judge pages | Competitive Companion (last phase) |

## Development

| Limitation | Notes |
|---|---|
| Vite sometimes re-optimizes dependencies after an install (504 "Outdated Optimize Dep") | Reload the page once |
| Running two dev servers on the same ports fails with EADDRINUSE | API uses 7420 (`PORT`), Vite uses 5173; set `CP_IDE_SERVER_PORT` for Vite's proxy when changing the API port |
| Plugin server routes are typed per plugin, not part of the core `AppType` | By design; use `ctx.rpc<PluginRoutes<typeof plugin>>()` |
