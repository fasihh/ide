import { useMemo } from "react";
import { create } from "zustand";
import type {
  CommandContribution,
  CoreEvents,
  OverlayContribution,
  Disposable,
  NewItemContribution,
  PanelContribution,
  StatusBarContribution,
  UiItemContribution,
  WebPluginContext,
} from "@cp-ide/plugin-api/web";
import { Emitter, toDisposable } from "@cp-ide/plugin-api/web";
import type { SettingDescriptors } from "@cp-ide/shared";

/** A contribution plus the context of the plugin that made it (components get that ctx). */
export type Owned<T> = T & { owner: WebPluginContext };

type RegistryState = {
  panels: Owned<PanelContribution>[];
  commands: Owned<CommandContribution>[];
  statusBar: Owned<StatusBarContribution>[];
  toolbar: Owned<UiItemContribution>[];
  overlays: Owned<OverlayContribution>[];
  newItems: NewItemContribution[];
  settings: { pluginId: string; descriptors: SettingDescriptors }[];
};

/** Everything plugins have contributed. A store so the UI re-renders as plugins (de)register. */
export const useRegistry = create<RegistryState>(() => ({
  panels: [],
  commands: [],
  statusBar: [],
  toolbar: [],
  overlays: [],
  newItems: [],
  settings: [],
}));

function add<K extends keyof RegistryState>(key: K, item: RegistryState[K][number], unique?: (x: RegistryState[K][number]) => boolean): Disposable {
  useRegistry.setState((s) => {
    const list = s[key] as RegistryState[K][number][];
    const filtered = unique ? list.filter((x) => !unique(x)) : list;
    return { [key]: [...filtered, item] } as Partial<RegistryState>;
  });
  return toDisposable(() =>
    useRegistry.setState((s) => ({ [key]: (s[key] as unknown[]).filter((x) => x !== item) }) as Partial<RegistryState>),
  );
}

export const registry = {
  addPanel: (p: Owned<PanelContribution>) => add("panels", p, (x) => x.id === p.id),
  addCommand: (c: Owned<CommandContribution>) => add("commands", c, (x) => x.id === c.id),
  addStatusBarItem: (i: Owned<StatusBarContribution>) => add("statusBar", i, (x) => x.id === i.id),
  addToolbarItem: (i: Owned<UiItemContribution>) => add("toolbar", i, (x) => x.id === i.id),
  addOverlay: (o: Owned<OverlayContribution>) => add("overlays", o, (x) => x.id === o.id),
  addNewItem: (n: NewItemContribution) => add("newItems", n, (x) => x.id === n.id),
  addSettings: (pluginId: string, descriptors: SettingDescriptors) => add("settings", { pluginId, descriptors }),
  panel: (id: string) => useRegistry.getState().panels.find((p) => p.id === id),
  command: (id: string) => useRegistry.getState().commands.find((c) => c.id === id),
  panelsList: () => [...useRegistry.getState().panels],
  commandsList: () => [...useRegistry.getState().commands],
};

/** New-menu entries in display order (a React hook). */
export function useNewItems(): NewItemContribution[] {
  const items = useRegistry((s) => s.newItems);
  return useMemo(() => [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [items]);
}

export const events = new Emitter<CoreEvents>();

const services = new Map<string, object>();
const waiting = new Map<string, Set<(service: object) => void>>();

/** Plugin-to-plugin service registry (see `ServicesApi`). */
export const serviceRegistry = {
  provide(name: string, service: object) {
    if (services.has(name)) console.warn(`[services] "${name}" is provided twice; the last one wins`);
    services.set(name, service);
    for (const cb of waiting.get(name) ?? []) cb(service);
    waiting.delete(name);
    return toDisposable(() => {
      if (services.get(name) === service) services.delete(name);
    });
  },
  get: (name: string) => services.get(name),
  whenAvailable(name: string, callback: (service: object) => void) {
    const existing = services.get(name);
    if (existing) {
      callback(existing);
      return toDisposable(() => {});
    }
    let set = waiting.get(name);
    if (!set) waiting.set(name, (set = new Set()));
    set.add(callback);
    return toDisposable(() => set.delete(callback));
  },
};
