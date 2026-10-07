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
  Use a temporary `CP_IDE_HOME` when running the server for tests so `~/.cp-ide` is not touched.
- Windows is the primary platform: watch for `.exe` suffixes, NTSTATUS exit codes and CRLF.
