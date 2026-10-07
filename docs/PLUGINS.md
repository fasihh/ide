# Writing plugins (tools)

Everything visible in cp-ide is contributed by plugins — the built-in explorer, editor, tests,
output, problem and settings panels live in `plugins/core` and use only the public API below. A new
tool can therefore do anything the built-ins do.

## Anatomy

```
plugins/my-tool/
  package.json        # name "@cp-ide/plugin-my-tool", deps: @cp-ide/plugin-api, shared, ui, react…
  tsconfig.json       # extends ../../tsconfig.base.json (copy from plugins/toolchain)
  src/web.tsx         # optional: default export definePlugin({...})
  src/server.ts       # optional: default export defineServerPlugin({...})
```

Discovery is by convention — no registration step:
- the web app globs `plugins/*/src/web.tsx` (`apps/web/src/core/plugin-host.ts`)
- the server scans `plugins/*/src/server.ts` (`apps/server/src/plugin-host.ts`)

After adding a folder: `pnpm install`, restart `pnpm dev`. The `id` must be the same in both halves
(the web half's `ctx.rpc()` targets `/api/plugins/<id>`). Plugins can be disabled in
Settings → Plugins (`plugins.disabled`); `required: true` plugins cannot. Changes need a reload.

## Web half

```tsx
import { definePlugin } from "@cp-ide/plugin-api/web";
import { Button } from "@cp-ide/ui";

export default definePlugin({
  id: "hello",
  name: "Hello",
  description: "Example tool",
  activate(ctx) {
    ctx.panels.register({
      id: "hello.panel",
      title: "Hello",
      placement: "right",           // left | center | right | bottom
      component: ({ ctx }) => {
        const name = ctx.workspace.use((s) => s.problem?.meta.name);
        return <Button onClick={() => ctx.runner.run()}>Run {name}</Button>;
      },
    });
    ctx.commands.register({ id: "hello.say", title: "Say hello", keybinding: "alt+h", run: () => ctx.notify.info("hello") });
    ctx.events.on("run:finished", ({ results }) => console.log(results));
  },
});
```

`ctx` (see `packages/plugin-api/src/web.ts` for exact types):

| Member | What it gives you |
|---|---|
| `workspace` | problems list, open problem, buffers, active file (`get`/`use`/`subscribe`), `openProblem`, `createProblem`, `createScratch`, `updateMeta(patch, id?)`, `renameProblem`/`moveProblem`/`deleteProblem`/`restoreProblem`, `setBuffer`, `save`, `createFile`/`renameFile`/`deleteFile`, `addTest`/`updateTest`/`removeTest`/`duplicateTest`/`moveTest` |
| `runner` | state (`phase`, `compile`, per-test state, `custom`), `compile()` (main + interactor for interactive problems), `run(testIds?)`, `runCustom(input)`, `exec(req)` for arbitrary input |
| `settings` | typed `get`/`use`/`set` for core keys, `contribute(descriptors)` → typed scoped accessor, `useSchema()`/`update()` for settings UIs |
| `panels` | `register`, `open`, `close`, `toggle`, `isOpen`, `useIsOpen`, `list` |
| `commands` | `register` (with optional `keybinding` and `when` condition), `execute(id, ...args)`, `list`/`useList` (effective keybindings), `setKeybinding`, `recordKeybinding`, `formatKeybinding` |
| `layout` | `registerPreset({ id, name, panels })`, `applyPreset`, `listPresets`, `saveCurrent(name)`, `deleteSaved`, `reset` |
| `ui` | `quickPick(items)`, `prompt({ title, validate })`, `confirm({ title, destructive })` — all promise-based |
| `library` | templates & snippets: `list(kind)`, `use(kind)` (hook), `save`, `create`, `rename`, `remove` |
| `toolbar` / `statusBar` | `register({ id, order, component })` (status bar also takes `align`) |
| `overlays` | `register({ id, component })` — rendered at the app root (palettes, dialogs, HUDs) |
| `services` | `provide(name, obj)` / `get<T>(name)` / `whenAvailable<T>(name, cb)` — share an API with other plugins (order-independent with `whenAvailable`) |
| `events` | `on`/`emit` for `CoreEvents` (augmentable) |
| `notify` | toasts, optionally with an action button: `notify.success(msg, desc, { label: "Undo", run })` |
| `theme` | resolved `"dark" \| "light"` (`get`/`use`) |
| `plugins` | list of loaded plugins |
| `rpc<T>()` | typed Hono client for this plugin's server routes |

Every `register`/`on` returns a `Disposable` and is also tracked per plugin automatically.

**Store selectors must return stable values.** `ctx.workspace.use(sel)` is a zustand hook: return
primitives or existing references (`s.problem`, `s.problem?.id`). Building a new object/array inside
the selector re-renders forever — derive in the component (or `useMemo`) instead.

Commands other plugins can call (the palette, Ctrl+Shift+P, lists them all): `runner.runAll`,
`runner.runCustom`, `workspace.save`, `workspace.newScratch`, `workspace.newProblem`, `editor.newFile(name?)`,
`editor.renameFile(name?)`, `editor.deleteFile(name?)`, `editor.revealLine(line, col)`, `editor.focus`,
`tests.add`, `tests.import`, `settings.open`, `keybindings.open`, `layout.preset.<id>`, `view.toggle.<panelId>`,
`problems.rename|move|delete|copyPath(id?)`, `problems.mark.<status>`, `snippets.insert`, `editor.insertText(text)`, `library.open`.

Events worth knowing: `problems:changed` (files changed on disk, any source) and `problem:reloaded`
(the open problem was refreshed from disk).

Registering a command with an existing id replaces it — `plugins/format` uses this to wrap
`workspace.save` with format-on-save. Pass the original `defaultKeybinding` when you do.

### Custom events

```ts
declare module "@cp-ide/plugin-api/web" {
  interface CoreEvents { "stress:found": { input: string } }
}
ctx.events.emit("stress:found", { input });
```

### Adding a palette mode

The palette plugin provides a `palette` service. Import its types and register a provider:

```ts
import type { PaletteService } from "@cp-ide/plugin-palette";

ctx.services.get<PaletteService>("palette")?.registerProvider({
  id: "tags",
  prefix: "@",            // type "@" in the palette to enter this mode ("" = default mode section)
  title: "Problems by tag",
  provide: (query) =>
    ctx.workspace.get().problems.map((p) => ({
      id: p.id,
      label: p.name,
      description: p.tags.join(", "),
      keywords: p.tags.join(" "),
      run: () => ctx.workspace.openProblem(p.id),
    })),
});
```

Items are fuzzy-filtered by `label` (then `description`/`keywords`) unless the provider sets
`filter: false`. An item's `run(palette)` can call `palette.setQuery(...)` with `keepOpen: true` to
chain modes. Add `"@cp-ide/plugin-palette": "workspace:*"` to your plugin's dependencies for the types.
Plugins activate in order (required first, then by id), so use `ctx.services.whenAvailable("palette", …)`
to register regardless of order (the core plugin's `@` snippets mode does this).

### Settings

```ts
import { defineSettings } from "@cp-ide/shared";
const settings = defineSettings({
  "hello.greeting": { section: "Hello", label: "Greeting", type: "string", default: "hi" },
});
const cfg = ctx.settings.contribute(settings);  // appears in the Settings panel
cfg.get("hello.greeting");                      // typed as string
```

Prefix keys with the plugin id. Types: `string`, `number` (min/max/step), `boolean`, `enum`
(options), `stringList`. To have the server validate them too, also list them in the server
half's `settings` field.

## Server half

```ts
import { Hono } from "hono";
import { defineServerPlugin } from "@cp-ide/plugin-api/server";

const plugin = defineServerPlugin({
  id: "hello",
  name: "Hello",
  routes: (ctx) =>
    new Hono().get("/count", async (c) => c.json({ problems: (await ctx.problems.list()).length })),
  setup(ctx) {
    ctx.on("problem:created", ({ problem }) => ctx.log("new problem", problem.id));
  },
});
export default plugin;
```

Calling it from the web half — fully typed, no hand-written types:

```ts
import { type PluginRoutes, unwrap } from "@cp-ide/plugin-api/web";
import type serverPlugin from "./server.ts";

const api = ctx.rpc<PluginRoutes<typeof serverPlugin>>();
const { problems } = await unwrap(api.count.$get()); // throws the server's { error } on failure
```

Prefer `unwrap` over `res.json()`: it drops a zod validator's 400 response from the type.
Settings used by both halves can live in a shared module (see `plugins/format/src/settings.ts`):
pass them to `settings` on the server and to `ctx.settings.contribute()` on the web side.

Server `ctx`: `websocket(path, handler)` (served at `/api/plugins/<id>/<path>`, local origins only),
`settings` (get/getRaw/all), `problems` (list/get/create/createScratch/updateMeta/
writeFile/writeTests/createFile/deleteFile/renameFile/move/trash/restore/dir/root), `library`
(list/read/save), `runner` (compile/exec/interact/start — `start` gives a live process session), `on(event)` for `ServerEvents` (`problem:created`,
`problem:updated`, `compile:done`, `settings:changed`, `problems:changed`), `dataDir`, `log`.
`setup` may start its own listeners (e.g. the planned Competitive Companion receiver).

See `plugins/toolchain` and `plugins/format` for complete small examples of both halves, and
`plugins/playground` for WebSockets + live process sessions.

### Embedding an editor

Use `CodeEditor` from `@cp-ide/editor` (add it to your dependencies): it applies the user's editor
settings, theme and Vim mode and places suggestion/hover widgets correctly inside dock panels.

```tsx
import { CodeEditor } from "@cp-ide/editor";
<CodeEditor ctx={ctx} path="myplugin/notes.cpp" language="cpp" value={text} onChange={setText} />
```
