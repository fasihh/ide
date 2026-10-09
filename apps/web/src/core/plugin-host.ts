import { hc } from "hono/client";
import { create } from "zustand";
import {
  DisposableStore,
  type PluginInfo,
  type ScopedSettings,
  type WebPlugin,
  type WebPluginContext,
} from "@cp-ide/plugin-api/web";
import type { SettingDescriptors } from "@cp-ide/shared";
import { api, unwrap } from "../api.ts";
import { formatKeybinding, listCommands, recordKeybinding, setKeybinding, useCommandList } from "./keybindings.ts";
import { languageServersApi } from "./language-servers.ts";
import { layout, useLayout } from "./layout.ts";
import { uiApi } from "./ui.ts";
import { libraryApi } from "./library.ts";
import { runApi } from "./run.ts";
import { notify } from "./notify.ts";
import { events, registry, serviceRegistry, useNewItems } from "./registry.ts";
import { runnerApi } from "./runner.ts";
import { getSetting, readSetting, updateSettings, useSetting, useSettings, useSettingsSchema } from "./settings.ts";
import { themeApi } from "./theme.ts";
import { workspaceApi } from "./workspace.ts";

/**
 * Plugins are discovered by convention: `plugins/<folder>/src/web.tsx` default-exports a
 * `WebPlugin` (and optionally `src/server.ts` a `ServerPlugin`). Dropping a folder in
 * `plugins/` is all it takes to add a tool.
 */
const modules = import.meta.glob<{ default: WebPlugin }>("../../../../plugins/*/src/web.tsx", { eager: true });

/** Discovered plugins and their state; replaced as a whole, so readers never see a half-built list. */
const usePluginInfos = create<{ infos: PluginInfo[] }>(() => ({ infos: [] }));
const stores = new Map<string, DisposableStore>();

function createContext(plugin: WebPlugin, disposables: DisposableStore): WebPluginContext {
  const ctx: WebPluginContext = {
    pluginId: plugin.id,
    workspace: workspaceApi,
    runner: runnerApi,
    settings: {
      get: getSetting,
      use: useSetting,
      set: (key, value) => updateSettings({ [key]: value }),
      contribute<T extends SettingDescriptors>(descriptors: T): ScopedSettings<T> {
        const d = disposables.add(registry.addSettings(plugin.id, descriptors));
        return {
          get: (key) => readSetting(useSettings.getState().values, key) as never,
          use: (key) => useSettings((s) => readSetting(s.values, key)) as never,
          set: (key, value) => updateSettings({ [key]: value }),
          dispose: () => d.dispose(),
        };
      },
      useSchema: useSettingsSchema,
      update: updateSettings,
    },
    commands: {
      register: (command) => disposables.add(registry.addCommand({ ...command, owner: ctx })),
      async execute(id, ...args) {
        const cmd = registry.command(id);
        if (!cmd) throw new Error(`Unknown command: ${id}`);
        return cmd.run(...args);
      },
      list: listCommands,
      useList: useCommandList,
      setKeybinding,
      recordKeybinding,
      formatKeybinding,
    },
    panels: {
      register: (panel) => disposables.add(registry.addPanel({ ...panel, owner: ctx })),
      open: layout.open,
      close: layout.close,
      toggle: layout.toggle,
      isOpen: (id) => useLayout.getState().open.includes(id),
      active: () => useLayout.getState().active,
      useActive: () => useLayout((s) => s.active),
      useIsOpen: (id) => useLayout((s) => s.open.includes(id)),
      list: () => registry.panelsList(),
    },
    statusBar: { register: (item) => disposables.add(registry.addStatusBarItem({ ...item, owner: ctx })) },
    toolbar: { register: (item) => disposables.add(registry.addToolbarItem({ ...item, owner: ctx })) },
    overlays: { register: (overlay) => disposables.add(registry.addOverlay({ ...overlay, owner: ctx })) },
    newItems: { register: (item) => disposables.add(registry.addNewItem(item)), useList: useNewItems },
    services: {
      provide: (name, service) => disposables.add(serviceRegistry.provide(name, service)),
      get: <T extends object>(name: string) => serviceRegistry.get(name) as T | undefined,
      whenAvailable: <T extends object>(name: string, cb: (service: T) => void) =>
        disposables.add(serviceRegistry.whenAvailable(name, cb as (service: object) => void)),
    },
    events: {
      on: (event, handler) => disposables.add(events.on(event, handler)),
      emit: (event, payload) => events.emit(event, payload),
    },
    layout: {
      listPresets: layout.listPresets,
      registerPreset: (preset) => disposables.add(layout.registerPreset(preset)),
      applyPreset: layout.applyPreset,
      saveCurrent: layout.saveCurrent,
      deleteSaved: layout.deleteSaved,
      reset: layout.reset,
    },
    library: libraryApi,
    run: {
      ...runApi,
      register: (target) => disposables.add(runApi.register(target)),
    },
    languageServers: languageServersApi,
    ui: uiApi,
    notify,
    theme: themeApi,
    plugins: { list: () => usePluginInfos.getState().infos, useList: () => usePluginInfos((s) => s.infos) },
    rpc: () => hc(`${location.origin}/api/plugins/${plugin.id}`) as never,
  };
  return ctx;
}

/** Discovered web plugins, required (core) ones first so others can rely on their commands/panels. */
const discovered: WebPlugin[] = Object.entries(modules)
  .map(([path, mod]) => {
    if (!mod.default?.id) console.error(`[plugins] ${path} has no default WebPlugin export`);
    return mod.default;
  })
  .filter(Boolean)
  .sort((a, b) => Number(!!b.required) - Number(!!a.required) || a.id.localeCompare(b.id));

async function activate(plugin: WebPlugin) {
  const disposables = new DisposableStore();
  stores.set(plugin.id, disposables);
  try {
    const result = await plugin.activate(createContext(plugin, disposables));
    if (result) disposables.add(result);
  } catch (err) {
    console.error(`[plugins] ${plugin.id} failed to activate`, err);
    notify.error(`Plugin "${plugin.name}" failed to activate`, err instanceof Error ? err.message : String(err));
    disposables.dispose();
    stores.delete(plugin.id);
  }
}

/** Disposing the store removes everything the plugin registered (panels close, commands go away…). */
function deactivate(id: string) {
  stores.get(id)?.dispose();
  stores.delete(id);
}

let reconciling: Promise<void> = Promise.resolve();

/**
 * Bring the running plugins in line with `plugins.disabled`. Called at startup and whenever the server
 * reports `plugins-changed` — by then its halves are (de)activated, so a web half never calls routes
 * that are not mounted yet.
 */
export function reconcilePlugins(): Promise<void> {
  reconciling = reconciling.then(async () => {
    const serverPlugins = await unwrap(api.plugins.$get()).catch(() => []);
    const serverIds = new Set(serverPlugins.map((p) => p.id));
    const disabled = new Set(getSetting("plugins.disabled"));
    const infos = discovered.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      required: plugin.required,
      enabled: !!plugin.required || !disabled.has(plugin.id),
      hasServer: serverIds.has(plugin.id),
    }));
    usePluginInfos.setState({ infos });
    for (const [i, plugin] of discovered.entries()) {
      const { enabled } = infos[i]!;
      if (enabled && !stores.has(plugin.id)) await activate(plugin);
      else if (!enabled && stores.has(plugin.id)) deactivate(plugin.id);
    }
  });
  return reconciling;
}

