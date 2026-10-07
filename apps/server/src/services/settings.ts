import fs from "node:fs/promises";
import path from "node:path";
import {
  type CoreSettings,
  type SettingDescriptors,
  coreSettings,
  validateSetting,
} from "@cp-ide/shared";
import type { SettingsService as SettingsApi } from "@cp-ide/plugin-api/server";
import { SETTINGS_FILE } from "../paths.ts";
import { HttpError } from "../errors.ts";
import { writeFileAtomic } from "../fs-utils.ts";

export class SettingsService implements SettingsApi {
  private overrides: Record<string, unknown> = {};
  private descriptors: SettingDescriptors = { ...coreSettings };
  private listeners = new Set<(changed: Record<string, unknown>) => void>();

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8"));
      if (raw && typeof raw === "object") this.overrides = raw;
    } catch (err: any) {
      if (err.code !== "ENOENT") console.warn(`[settings] could not read ${SETTINGS_FILE}:`, err.message);
    }
  }

  /** Server plugins contribute descriptors so their values are validated too. */
  addDescriptors(d: SettingDescriptors) {
    Object.assign(this.descriptors, d);
  }

  get<K extends keyof CoreSettings>(key: K): CoreSettings[K] {
    return this.getRaw(key) as CoreSettings[K];
  }

  getRaw(key: string): unknown {
    return key in this.overrides ? this.overrides[key] : this.descriptors[key]?.default;
  }

  all(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, d] of Object.entries(this.descriptors)) out[k] = d.default;
    return { ...out, ...this.overrides };
  }

  getOverrides() {
    return { ...this.overrides };
  }

  /**
   * Apply a patch. `null` resets a key to its default. Keys with a known descriptor are
   * validated; unknown keys (settings contributed by web-only plugins) are stored as-is.
   */
  async update(patch: Record<string, unknown>) {
    const next = { ...this.overrides };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        delete next[key];
        continue;
      }
      const d = this.descriptors[key];
      if (d) {
        const res = validateSetting(d, value);
        if (!res.ok) throw new HttpError(400, `Invalid value for ${key}: ${res.error}`);
        if (JSON.stringify(value) === JSON.stringify(d.default)) {
          delete next[key];
          continue;
        }
      }
      next[key] = value;
    }
    this.overrides = next;
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await writeFileAtomic(SETTINGS_FILE, JSON.stringify(next, null, 2));
    for (const l of this.listeners) l(patch);
  }

  onChange(listener: (changed: Record<string, unknown>) => void) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}
