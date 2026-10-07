import { hc } from "hono/client";
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
import { layout, useLayout } from "./layout.ts";
import { uiApi } from "./ui.ts";
import { libraryApi } from "./library.ts";
import { notify } from "./notify.ts";
import { events, registry } from "./registry.ts";
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

const infos: PluginInfo[] = [];
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
      useIsOpen: (id) => useLayout((s) => s.open.includes(id)),
      list: () => registry.panelsList(),
    },
    statusBar: { register: (item) => disposables.add(registry.addStatusBarItem({ ...item, owner: ctx })) },
    toolbar: { register: (item) => disposables.add(registry.addToolbarItem({ ...item, owner: ctx })) },
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
    ui: uiApi,
    notify,
    theme: themeApi,
    plugins: { list: () => [...infos] },
    rpc: () => hc(`${location.origin}/api/plugins/${plugin.id}`) as never,
  };
  return ctx;
}

export async function activatePlugins() {
  const serverPlugins = await unwrap(api.plugins.$get()).catch(() => []);
  const serverIds = new Set(serverPlugins.map((p) => p.id));
  const disabled = new Set(getSetting("plugins.disabled"));

  const plugins = Object.entries(modules)
    .map(([path, mod]) => {
      if (!mod.default?.id) console.error(`[plugins] ${path} has no default WebPlugin export`);
      return mod.default;
    })
    .filter(Boolean)
    // Required (core) plugins first so others can rely on their commands/panels.
    .sort((a, b) => Number(!!b.required) - Number(!!a.required) || a.id.localeCompare(b.id));

  for (const plugin of plugins) {
    const enabled = plugin.required || !disabled.has(plugin.id);
    infos.push({
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      required: plugin.required,
      enabled,
      hasServer: serverIds.has(plugin.id),
    });
    if (!enabled) continue;
    const disposables = new DisposableStore();
    stores.set(plugin.id, disposables);
    try {
      const result = await plugin.activate(createContext(plugin, disposables));
      if (result) disposables.add(result);
    } catch (err) {
      console.error(`[plugins] ${plugin.id} failed to activate`, err);
      notify.error(`Plugin "${plugin.name}" failed to activate`, err instanceof Error ? err.message : String(err));
      disposables.dispose();
    }
  }
}

export function pluginInfos() {
  return [...infos];
}
