import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Hono } from "hono";
import { type Disposable, DisposableStore, type ServerPlugin, type ServerPluginContext } from "@cp-ide/plugin-api/server";
import { PLUGINS_DIR, PLUGIN_DATA_DIR } from "./paths.ts";
import type { Services } from "./services/index.ts";
import type { SocketRouter } from "./sockets.ts";

export type ServerPluginInfo = { id: string; name: string; description?: string; enabled: boolean; error?: string };

/**
 * Discovers server plugins by convention: every `plugins/<folder>/src/server.ts` whose
 * default export is a `ServerPlugin`. Routes are mounted at `/api/plugins/<id>`.
 */
export class ServerPluginHost implements Disposable {
  readonly infos: ServerPluginInfo[] = [];
  /** Whatever plugins' `setup` returned; disposed when the server shuts down. */
  private readonly disposables = new DisposableStore();

  constructor(
    private services: Services,
    private sockets: SocketRouter,
  ) {}

  async load(api: Hono<any, any, any>) {
    let folders: string[] = [];
    try {
      folders = (await fs.readdir(PLUGINS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return;
    }
    const disabled = new Set(this.services.settings.get("plugins.disabled"));

    for (const folder of folders.sort()) {
      const entry = path.join(PLUGINS_DIR, folder, "src", "server.ts");
      if (!(await fs.access(entry).then(() => true, () => false))) continue;

      let plugin: ServerPlugin;
      try {
        plugin = (await import(pathToFileURL(entry).href)).default;
        if (!plugin?.id) throw new Error("default export is not a ServerPlugin");
      } catch (err: any) {
        console.error(`[plugins] failed to load ${folder}:`, err);
        this.infos.push({ id: folder, name: folder, enabled: false, error: String(err?.message ?? err) });
        continue;
      }

      const info: ServerPluginInfo = { id: plugin.id, name: plugin.name, description: plugin.description, enabled: !disabled.has(plugin.id) };
      this.infos.push(info);
      if (plugin.settings) this.services.settings.addDescriptors(plugin.settings);
      if (!info.enabled) continue;

      try {
        const ctx = this.createContext(plugin.id);
        if (plugin.routes) api.route(`/plugins/${plugin.id}`, plugin.routes(ctx));
        const disposable = await plugin.setup?.(ctx);
        if (disposable) this.disposables.add(disposable);
        console.log(`[plugins] loaded ${plugin.id}`);
      } catch (err: any) {
        console.error(`[plugins] failed to activate ${plugin.id}:`, err);
        info.enabled = false;
        info.error = String(err?.message ?? err);
      }
    }
  }

  dispose() {
    this.disposables.dispose();
  }

  private createContext(pluginId: string): ServerPluginContext {
    const { settings, problems, library, runner, events } = this.services;
    return {
      pluginId,
      dataDir: path.join(PLUGIN_DATA_DIR, pluginId),
      settings,
      problems,
      library,
      runner,
      on: (event, handler) => events.on(event, handler),
      websocket: (path, handler) => this.sockets.add(`/api/plugins/${pluginId}/${path.replace(/^\/+/, "")}`, handler),
      log: (...args) => console.log(`[${pluginId}]`, ...args),
    };
  }
}
