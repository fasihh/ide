import { useMemo } from "react";
import { create } from "zustand";
import type { SettingsSchema } from "@cp-ide/plugin-api/web";
import { type CoreSettings, type SettingDescriptor, coreSettings } from "@cp-ide/shared";
import { api, unwrap } from "../api.ts";
import { events, useRegistry } from "./registry.ts";
import { reportError } from "./notify.ts";

type SettingsState = {
  /** Effective values from the server (defaults merged with overrides). */
  values: Record<string, unknown>;
  overrides: Record<string, unknown>;
  loaded: boolean;
};

export const useSettings = create<SettingsState>(() => ({ values: {}, overrides: {}, loaded: false }));

/** Core descriptors plus everything plugins contributed. */
export function allDescriptors(): Record<string, SettingDescriptor & { pluginId?: string }> {
  const out: Record<string, SettingDescriptor & { pluginId?: string }> = { ...coreSettings };
  for (const { pluginId, descriptors } of useRegistry.getState().settings) {
    for (const [k, d] of Object.entries(descriptors)) out[k] = { ...d, pluginId };
  }
  return out;
}

export function readSetting(values: Record<string, unknown>, key: string): unknown {
  return key in values ? values[key] : allDescriptors()[key]?.default;
}

export function getSetting<K extends keyof CoreSettings>(key: K): CoreSettings[K] {
  return readSetting(useSettings.getState().values, key) as CoreSettings[K];
}

export function useSetting<K extends keyof CoreSettings>(key: K): CoreSettings[K] {
  return useSettings((s) => readSetting(s.values, key)) as CoreSettings[K];
}

export async function loadSettings() {
  const res = await unwrap(api.settings.$get());
  useSettings.setState({ values: res.values, overrides: res.overrides, loaded: true });
}

/** Optimistically apply, then persist. `null` resets to default. */
export async function updateSettings(patch: Record<string, unknown>) {
  const prev = useSettings.getState();
  const values = { ...prev.values };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete values[k];
    else values[k] = v;
  }
  useSettings.setState({ values });
  try {
    const res = await unwrap(api.settings.$patch({ json: patch }));
    useSettings.setState({ values: res.values, overrides: res.overrides });
    for (const [key, value] of Object.entries(patch)) events.emit("settings:changed", { key, value });
  } catch (err) {
    useSettings.setState({ values: prev.values });
    reportError("Could not save setting")(err);
    throw err;
  }
}

export function useSettingsSchema(): SettingsSchema {
  const contributed = useRegistry((s) => s.settings);
  const values = useSettings((s) => s.values);
  const overrides = useSettings((s) => s.overrides);
  const descriptors = useMemo(allDescriptors, [contributed]);
  return useMemo(() => ({ descriptors, values, overrides }), [descriptors, values, overrides]);
}
