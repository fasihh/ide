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
| `workspace` | problems list, open problem, buffers, active file (`get`/`use`/`subscribe`), `openProblem`, `createProblem`, `createScratch`, `updateMeta`, `setBuffer`, `save`, `addTest`/`updateTest`/`removeTest` |
| `runner` | state (`phase`, `compile`, per-test state), `compile()`, `run(testIds?)`, `exec(req)` for arbitrary input |
| `settings` | typed `get`/`use`/`set` for core keys, `contribute(descriptors)` → typed scoped accessor, `useSchema()`/`update()` for settings UIs |
| `panels` | `register`, `open`, `close`, `toggle`, `useIsOpen`, `list` |
| `commands` | `register` (with optional `keybinding`), `execute(id, ...args)`, `list` |
| `toolbar` / `statusBar` | `register({ id, order, component })` (status bar also takes `align`) |
| `events` | `on`/`emit` for `CoreEvents` (augmentable) |
| `notify` | toasts |
| `theme` | resolved `"dark" \| "light"` (`get`/`use`) |
| `plugins` | list of loaded plugins |
| `rpc<T>()` | typed Hono client for this plugin's server routes |

Every `register`/`on` returns a `Disposable` and is also tracked per plugin automatically.

**Store selectors must return stable values.** `ctx.workspace.use(sel)` is a zustand hook: return
primitives or existing references (`s.problem`, `s.problem?.id`). Building a new object/array inside
the selector re-renders forever — derive in the component (or `useMemo`) instead.

Commands other plugins can call: `runner.runAll`, `workspace.save`, `workspace.newScratch`,
`workspace.newProblem`, `tests.add`, `settings.open`, `editor.revealLine(line, col)`,
`editor.focus`, `view.toggle.<panelId>`.

### Custom events

```ts
declare module "@cp-ide/plugin-api/web" {
  interface CoreEvents { "stress:found": { input: string } }
}
ctx.events.emit("stress:found", { input });
```

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
import type { PluginRoutes } from "@cp-ide/plugin-api/web";
import type serverPlugin from "./server.ts";

const api = ctx.rpc<PluginRoutes<typeof serverPlugin>>();
const res = await api.count.$get();
const { problems } = await res.json();
```

Server `ctx`: `settings` (get/getRaw/all), `problems` (list/get/create/createScratch/updateMeta/
writeFile/writeTests/dir/root), `runner` (compile/exec), `on(event)` for `ServerEvents`
(`problem:created`, `problem:updated`, `compile:done`, `settings:changed`), `dataDir`, `log`.
`setup` may start its own listeners (e.g. the planned Competitive Companion receiver).

See `plugins/toolchain` for a complete small example of both halves.
