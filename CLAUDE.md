# cp-ide — notes for agents

Local web IDE for competitive programming (C++/Python). pnpm + turbo monorepo; Hono (RPC) server,
React + dockview + Monaco web app; every feature is a plugin.

- Read `docs/PLAN.md` (phases, checklist), `docs/PROGRESS.md` (latest state) and
  `docs/LIMITATIONS.md` (known issues) first. When you finish work: tick items in PLAN.md, add a
  dated entry to PROGRESS.md, and add/remove entries in LIMITATIONS.md.
- New features go in plugins (`plugins/<name>/src/{web.tsx,server.ts}`) using only
  `@cp-ide/plugin-api`. Extend the API in `packages/plugin-api` (and implement it in
  `apps/web/src/core/plugin-host.ts` / `apps/server/src/plugin-host.ts`) rather than importing app internals.
- Core API routes must stay chained in `apps/server/src/routes` so `AppType` keeps its types; the web
  client calls them through `unwrap(api....)`.
- Shared domain types and settings descriptors live in `packages/shared`; new global settings go in
  `coreSettings` there (the settings UI is generated).
- Imports use explicit `.ts`/`.tsx` extensions. Internal packages export source; there is no build step.
- Verify with `pnpm typecheck` and `pnpm test` (server tests need g++ and python on PATH).
  Use a temporary `CP_IDE_HOME` when running the server for tests so `~/.cp-ide` and `~/cp` are not touched:
  run it with `pnpm --filter @cp-ide/server start` (not `dev` — a `tsx watch` parent can outlive a killed
  child and restart later), on non-default ports (e.g. `PORT=7421`, Vite `--port 5174` with
  `CP_IDE_SERVER_PORT=7421`) because the user may be running their own instance on 7420/5173, check
  `problemsRoot` points at the temp folder before creating anything, and stop servers before deleting
  the temp folder.
- Windows is the primary platform: watch for `.exe` suffixes, NTSTATUS exit codes and CRLF.
