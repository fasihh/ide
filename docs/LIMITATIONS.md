# Known limitations & issues

Keep this current: add an entry when you knowingly ship a limitation, remove it (and note the fix in
PROGRESS.md) when it is resolved. Planned fixes reference the phase in [PLAN.md](PLAN.md).

## Runner

| Limitation | Notes / planned fix |
|---|---|
| No memory limit and no peak-memory reporting | Needs Windows Job Objects / Linux prlimit (Phase 5) |
| Times are wall clock and include process start (~10–30 ms on Windows) | Good enough for spotting TLE; CPU time measurement would need native help |
| First run of a fresh `.exe` is slow on Windows (antivirus scan) | Mitigated by a warm-up launch after compiling. Adding `~/.cp-ide/cache` to Defender exclusions removes it entirely |
| Interactive problems are not supported | Phase 4 (interactor) |
| Only token / float / exact comparison; no custom checkers | Phase 4 (testlib-style checker) |
| Compile cache (`~/.cp-ide/cache`) is never pruned | Safe to delete manually any time |

## Editor

| Limitation | Notes / planned fix |
|---|---|
| No C++ IntelliSense (syntax highlighting + word completion only) | clangd over LSP (Phase 5) |
| Compiler squiggles disappear on reload | Re-run to get them back |

## Layout & UI

| Limitation | Notes / planned fix |
|---|---|
| A layout saved at one window size is restored proportionally at another | View → Reset layout. dockview has no per-group priority (Phase 2 investigation) |
| Some shortcuts are reserved by the browser (Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+Shift+N) | Hence Alt+N for new scratch; rebindable in Phase 2 |
| Enabling/disabling a plugin needs a page reload | No hot deactivation yet |

## Problems & storage

| Limitation | Notes / planned fix |
|---|---|
| Edits made to problem files outside the app aren't picked up until the problem is reopened | File watching (Phase 3) |
| No rename / move / delete of problems from the UI | Phase 3 |
| No import from judge pages | Competitive Companion (last phase) |

## Development

| Limitation | Notes |
|---|---|
| Vite sometimes re-optimizes dependencies after an install (504 "Outdated Optimize Dep") | Reload the page once |
| Running two dev servers on the same ports fails with EADDRINUSE | API uses 7420 (`PORT`), Vite uses 5173; set `CP_IDE_SERVER_PORT` for Vite's proxy when changing the API port |
| Plugin server routes are typed per plugin, not part of the core `AppType` | By design; use `ctx.rpc<PluginRoutes<typeof plugin>>()` |
