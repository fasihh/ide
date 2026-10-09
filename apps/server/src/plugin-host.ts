import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Hono, type Context } from "hono";
import { type Disposable, DisposableStore, type ServerPlugin, type ServerPluginContext } from "@cp-ide/plugin-api/server";
import { PLUGINS_DIR, PLUGIN_DATA_DIR } from "./paths.ts";
import type { Services } from "./services/index.ts";
import type { SocketRouter } from "./sockets.ts";

export type ServerPluginInfo = { id: string; name: string; description?: string; enabled: boolean; error?: string };

/** A running plugin: its routes and everything it registered through its context. */
type Active = { router: Hono<any, any, any> | null; disposables: DisposableStore };

/**
 * Discovers server plugins by convention (every `plugins/<folder>/src/server.ts` whose default export
 * is a `ServerPlugin`) and keeps them in line with the `plugins.disabled` setting while the server runs.
 *
 * - Routes: one dispatcher at `/api/plugins/:id/*` forwards to the plugin's router, or answers a JSON
 *   404 while the plugin is off (instead of falling through to the web app).
 * - Lifecycle: each plugin gets a context whose registrations (sockets, event listeners, language
 *   servers, launchers) are collected with whatever `setup` returns, and disposed when it is turned off.
 * - After each change `plugins:changed` is emitted, so the web app can follow.
 */
export class ServerPluginHost implements Disposable {
  readonly infos: ServerPluginInfo[] = [];
  private readonly plugins = new Map<string, ServerPlugin>();
  private readonly active = new Map<string, Active>();
  /** Reconciles run one after another; a burst of toggles cannot interleave activations. */
  private queue: Promise<void> = Promise.resolve();
  private settingsListener: Disposable | null = null;

  constructor(
    private services: Services,
    private sockets: SocketRouter,
  ) {}

  async load(api: Hono<any, any, any>) {
    for (const plugin of await this.discover()) {
      this.plugins.set(plugin.id, plugin);
      this.infos.push({ id: plugin.id, name: plugin.name, description: plugin.description, enabled: false });
      if (plugin.settings) this.services.settings.addDescriptors(plugin.settings);
    }
    const dispatch = (c: Context) => this.dispatch(c);
    api.all("/plugins/:id", dispatch).all("/plugins/:id/*", dispatch);
    this.settingsListener = this.services.events.on("settings:changed", ({ changed }) => {
      if ("plugins.disabled" in changed) void this.reconcile();
    });
    await this.reconcile();
  }

  /** Start enabled plugins that are not running and stop disabled ones that are. */
  reconcile(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const disabled = new Set(this.services.settings.get("plugins.disabled"));
      for (const [id, plugin] of this.plugins) {
        const wanted = !disabled.has(id);
        if (wanted && !this.active.has(id)) await this.activate(plugin);
        else if (!wanted && this.active.has(id)) this.deactivate(id);
      }
      this.services.events.emit("plugins:changed", {});
    });
    return this.queue;
  }

  dispose() {
    this.settingsListener?.dispose();
    for (const id of [...this.active.keys()]) this.deactivate(id);
  }

  private async activate(plugin: ServerPlugin) {
    const info = this.infos.find((i) => i.id === plugin.id)!;
    const disposables = new DisposableStore();
    try {
      const ctx = this.createContext(plugin.id, disposables);
      const router = plugin.routes ? new Hono().route(`/api/plugins/${plugin.id}`, plugin.routes(ctx)) : null;
      const result = await plugin.setup?.(ctx);
      if (result) disposables.add(result);
      this.active.set(plugin.id, { router, disposables });
      Object.assign(info, { enabled: true, error: undefined });
      console.log(`[plugins] activated ${plugin.id}`);
    } catch (err: any) {
      disposables.dispose();
      Object.assign(info, { enabled: false, error: String(err?.message ?? err) });
      console.error(`[plugins] failed to activate ${plugin.id}:`, err);
    }
  }

  private deactivate(id: string) {
    this.active.get(id)?.disposables.dispose();
    this.active.delete(id);
    const info = this.infos.find((i) => i.id === id);
    if (info) info.enabled = false;
    console.log(`[plugins] deactivated ${id}`);
  }

  private dispatch(c: Context) {
    const id = c.req.param("id");
    const router = id ? this.active.get(id)?.router : null;
    if (!router) return c.json({ error: this.plugins.has(id ?? "") ? `The "${id}" plugin is turned off` : `Unknown plugin "${id}"` }, 404);
    return router.fetch(c.req.raw);
  }

  private async discover(): Promise<ServerPlugin[]> {
    let folders: string[] = [];
    try {
      folders = (await fs.readdir(PLUGINS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    const found: ServerPlugin[] = [];
    for (const folder of folders.sort()) {
      const entry = path.join(PLUGINS_DIR, folder, "src", "server.ts");
      if (!(await fs.access(entry).then(() => true, () => false))) continue;
      try {
        const plugin: ServerPlugin = (await import(pathToFileURL(entry).href)).default;
        if (!plugin?.id) throw new Error("default export is not a ServerPlugin");
        found.push(plugin);
      } catch (err: any) {
        console.error(`[plugins] failed to load ${folder}:`, err);
        this.infos.push({ id: folder, name: folder, enabled: false, error: String(err?.message ?? err) });
      }
    }
    return found;
  }

  /** Everything registered through this context is disposed with the plugin. */
  private createContext(pluginId: string, disposables: DisposableStore): ServerPluginContext {
    const { settings, problems, library, runner, languageServers, events } = this.services;
    return {
      pluginId,
      dataDir: path.join(PLUGIN_DATA_DIR, pluginId),
      settings,
      problems,
      library,
      runner: {
        compile: (req) => runner.compile(req),
        exec: (req) => runner.exec(req),
        interact: (req) => runner.interact(req),
        start: (artifactId, opts) => runner.start(artifactId, opts),
        registerLauncher: (launcher) => disposables.add(runner.registerLauncher(launcher)),
      },
      languageServers: { register: (server) => disposables.add(languageServers.register(server)) },
      on: (event, handler) => disposables.add(events.on(event, handler)),
      websocket: (path, handler) => disposables.add(this.sockets.add(`/api/plugins/${pluginId}/${path.replace(/^\/+/, "")}`, handler)),
      log: (...args) => console.log(`[${pluginId}]`, ...args),
    };
  }
}
