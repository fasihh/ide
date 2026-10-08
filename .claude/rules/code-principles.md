# Code principles (cp-ide)

Strict rules for every change. Each rule names the seam or pattern in this repo that already follows it — copy that.

## Architecture

- **Core is generic; features are plugins.** Core (`apps/*`, `packages/*`) provides seams — registries,
  `register*()` methods, events — and never names a feature. A feature that needs new behaviour from
  core gets a new seam in `packages/plugin-api`, then lives in `plugins/<name>/`.
  Example: Python warm start is `plugins/python-warm`, attached through `RunnerService.registerLauncher`;
  the runner only asks launchers in order and falls back to a plain spawn. Language servers likewise:
  core owns the LSP client, sync and UI; `plugins/lsp-*` only `ctx.languageServers.register(...)`.
- **Resolve external tools portably**: PATH, a setting, or an npm dependency of the plugin. Probe them
  at runtime and report a missing tool with an install hint.
- **Plugins depend on `@cp-ide/plugin-api` and `@cp-ide/shared` only.** Tests in a plugin exercise the
  plugin's own units (`plugins/python-warm/src/launcher.test.ts`); seams are tested in core with fakes
  (`apps/server/src/server.test.ts`, "live sessions go through registered launchers").
- **The web half stays free of server types.** Types both halves need live in
  `packages/plugin-api/src/common.ts`, written structurally (`PluginRoutes`).

## Types and data

- **Carry facts from where they are known.** The step that knows something records it in a type; later
  steps read it. Model variants as discriminated unions (`Program` = `{ language: "cpp" … } | { language: "python" … }`)
  and switch on the tag, so no later step guesses from file extensions or string shapes.
- **One source of truth per decision.** A command line is built in exactly one place (`commandLine(program)`
  in the runner); anything else that launches the program derives from the same fields (`program.flags`).
- **`as` casts carry a comment stating the invariant** that makes them safe (see `spawnWorker` in `launcher.ts`).

## Code in its own language

- Python, shell, SQL and similar live in their own files with their own tooling and tests, loaded by path
  (`fileURLToPath(new URL("./warm_bootstrap.py", import.meta.url))`).

## Lifecycle

- **The creator owns disposal.** Every `register*()`/`on()` returns a `Disposable`; collect them in a
  `DisposableStore` and return it from `setup`/`activate`. The plugin host disposes on shutdown.
  Global hooks (`process.on`, module-level singletons) appear only at the composition root (`apps/server/src/index.ts`).
- **React to changes through events.** Subscribe to `settings:changed` and act immediately (free resources,
  rebuild) rather than re-reading a setting on the next call and cleaning up lazily.
- **Inject policy.** Classes take paths, limits and predicates (`enabled: () => boolean`, `idleMs`) as
  constructor options, so tests build them without the app.

## Processes and protocols

- **Separate control from data.** User stdin/stdout carry only the user's data; control messages travel on
  their own channel (fd 3 via `stdio: ["pipe","pipe","pipe","pipe"]` — verified on Windows).
- Children a plugin spawns ahead of time get an `error` listener and exit on their own when the server
  dies (EOF on their control pipe).

## Comments

- Comments state *why* or an invariant, one line where possible, matching the surrounding density.

## Done means

- [ ] Core contains no feature names (`grep` core for the plugin id / feature words).
- [ ] Every `register*()` / `on()` result is disposed by its creator.
- [ ] No fact is re-derived by sniffing; every cast has its invariant comment.
- [ ] New units have tests at their seam; `pnpm typecheck` and `pnpm test` pass.
- [ ] `docs/PLAN.md`, `docs/PROGRESS.md`, `docs/LIMITATIONS.md` (and `docs/PLUGINS.md` for API changes) updated.
