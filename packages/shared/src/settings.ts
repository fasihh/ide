/**
 * Settings are flat dotted keys (`editor.fontSize`), like VS Code. Core and plugins
 * both describe their settings with `SettingDescriptor`s; the settings UI is generated
 * from these descriptors and the server validates writes against them.
 *
 * Only overrides are persisted (`~/.cp-ide/settings.json`); defaults come from descriptors.
 */

type Base = {
  /** Groups settings in the settings UI. */
  section: string;
  label: string;
  description?: string;
};

export type SettingDescriptor =
  | (Base & { type: "string"; default: string; placeholder?: string; multiline?: boolean })
  | (Base & { type: "number"; default: number; min?: number; max?: number; step?: number })
  | (Base & { type: "boolean"; default: boolean })
  | (Base & { type: "enum"; default: string; options: readonly { value: string; label: string }[] })
  | (Base & { type: "stringList"; default: string[] })
  /** String → string map. `hidden` settings are edited by a dedicated UI (e.g. keyboard shortcuts). */
  | (Base & { type: "record"; default: Record<string, string>; hidden?: boolean });

export type SettingDescriptors = Record<string, SettingDescriptor>;

export type SettingValue<D> = D extends { type: "string" }
  ? string
  : D extends { type: "number" }
    ? number
    : D extends { type: "boolean" }
      ? boolean
      : D extends { type: "enum"; options: readonly (infer O)[] }
        ? O extends { value: infer V }
          ? V
          : never
        : D extends { type: "stringList" }
          ? string[]
          : D extends { type: "record" }
            ? Record<string, string>
            : never;

export type SettingValues<T extends SettingDescriptors> = { [K in keyof T]: SettingValue<T[K]> };

export function defineSettings<const T extends SettingDescriptors>(descriptors: T): T {
  return descriptors;
}

export function defaultValues<T extends SettingDescriptors>(descriptors: T): SettingValues<T> {
  const out: Record<string, unknown> = {};
  for (const [key, d] of Object.entries(descriptors)) out[key] = d.default;
  return out as SettingValues<T>;
}

export function validateSetting(
  d: SettingDescriptor,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (d.type) {
    case "string":
      return typeof value === "string" ? { ok: true, value } : { ok: false, error: "expected a string" };
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: "expected a boolean" };
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) return { ok: false, error: "expected a number" };
      if (d.min !== undefined && value < d.min) return { ok: false, error: `must be >= ${d.min}` };
      if (d.max !== undefined && value > d.max) return { ok: false, error: `must be <= ${d.max}` };
      return { ok: true, value };
    }
    case "enum":
      return d.options.some((o) => o.value === value)
        ? { ok: true, value }
        : { ok: false, error: `expected one of ${d.options.map((o) => o.value).join(", ")}` };
    case "stringList":
      return Array.isArray(value) && value.every((v) => typeof v === "string")
        ? { ok: true, value }
        : { ok: false, error: "expected a list of strings" };
    case "record":
      return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.values(value).every((v) => typeof v === "string")
        ? { ok: true, value }
        : { ok: false, error: "expected an object of strings" };
  }
}

// ---------------------------------------------------------------------------

export const coreSettings = defineSettings({
  // Appearance
  "appearance.theme": {
    section: "Appearance",
    label: "Theme",
    type: "enum",
    default: "dark",
    options: [
      { value: "dark", label: "Dark" },
      { value: "light", label: "Light" },
      { value: "system", label: "Follow system" },
    ],
  },
  "appearance.uiFontSize": {
    section: "Appearance",
    label: "UI font size",
    description: "Size (px) of regular UI text. Panels, controls and spacing scale with it. The editor has its own font size.",
    type: "number",
    default: 12,
    min: 9,
    max: 20,
  },

  // Editor
  "editor.fontFamily": {
    section: "Editor",
    label: "Font family",
    type: "string",
    default: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
  },
  "editor.fontSize": { section: "Editor", label: "Font size", type: "number", default: 14, min: 8, max: 40 },
  "editor.fontLigatures": { section: "Editor", label: "Font ligatures", type: "boolean", default: false },
  "editor.tabSize": { section: "Editor", label: "Tab size", type: "number", default: 4, min: 1, max: 8 },
  "editor.wordWrap": { section: "Editor", label: "Word wrap", type: "boolean", default: false },
  "editor.minimap": { section: "Editor", label: "Show minimap", type: "boolean", default: false },
  "editor.lineNumbers": {
    section: "Editor",
    label: "Line numbers",
    type: "enum",
    default: "on",
    options: [
      { value: "on", label: "On" },
      { value: "relative", label: "Relative" },
      { value: "off", label: "Off" },
    ],
  },
  "editor.vimMode": {
    section: "Editor",
    label: "Vim mode",
    description: "Vim keybindings in the code editor.",
    type: "boolean",
    default: false,
  },
  "editor.autoSave": {
    section: "Editor",
    label: "Auto save",
    description: "Save files automatically after you stop typing.",
    type: "boolean",
    default: true,
  },
  "editor.autoSaveDelayMs": {
    section: "Editor",
    label: "Auto save delay (ms)",
    type: "number",
    default: 800,
    min: 100,
    max: 10000,
  },

  // Problems
  "problems.root": {
    section: "Problems",
    label: "Problems root",
    description: "Folder where problems are stored. `~` expands to your home folder.",
    type: "string",
    default: "~/cp",
  },
  "problems.defaultLanguage": {
    section: "Problems",
    label: "Default language",
    type: "enum",
    default: "cpp",
    options: [
      { value: "cpp", label: "C++" },
      { value: "python", label: "Python" },
    ],
  },

  // Templates
  "templates.defaultCpp": {
    section: "Templates",
    label: "Default C++ template",
    description: "Template (from the Templates panel) used for new C++ problems and files.",
    type: "string",
    default: "main.cpp",
  },
  "templates.defaultPython": {
    section: "Templates",
    label: "Default Python template",
    type: "string",
    default: "main.py",
  },

  // Languages
  "cpp.compiler": { section: "C++", label: "Compiler", type: "string", default: "g++" },
  "cpp.standard": {
    section: "C++",
    label: "Standard",
    type: "enum",
    default: "c++20",
    options: [
      { value: "c++14", label: "C++14" },
      { value: "c++17", label: "C++17" },
      { value: "c++20", label: "C++20" },
      { value: "c++23", label: "C++23" },
    ],
  },
  "cpp.flags": {
    section: "C++",
    label: "Compiler flags",
    description: "Extra flags passed to the compiler. -DLOCAL lets you guard debug code with #ifdef LOCAL.",
    type: "string",
    default: "-O2 -Wall -Wextra -DLOCAL",
  },
  "cpp.stackSizeMb": {
    section: "C++",
    label: "Stack size (MB)",
    description: "Linked into the executable on Windows so deep recursion does not overflow. 0 disables.",
    type: "number",
    default: 256,
    min: 0,
    max: 2048,
  },
  "python.interpreter": {
    section: "Python",
    label: "Interpreter",
    description: "Command used to run Python, e.g. python, python3 or pypy3.",
    type: "string",
    default: "python",
  },

  // Runner
  "runner.timeLimitMs": {
    section: "Runner",
    label: "Default time limit (ms)",
    description: "Used when a problem does not define its own time limit.",
    type: "number",
    default: 2000,
    min: 100,
    max: 60000,
  },
  "runner.killAfterFactor": {
    section: "Runner",
    label: "Kill after (× time limit)",
    description: "Programs are reported TLE past the time limit, and killed once they run this many times longer.",
    type: "number",
    default: 2,
    min: 1,
    max: 10,
    step: 0.5,
  },
  "runner.compareMode": {
    section: "Runner",
    label: "Output comparison",
    type: "enum",
    default: "token",
    options: [
      { value: "token", label: "Tokens (ignore whitespace)" },
      { value: "float", label: "Tokens with float tolerance" },
      { value: "exact", label: "Exact (ignore trailing whitespace)" },
    ],
  },
  "runner.floatEpsilon": {
    section: "Runner",
    label: "Float tolerance",
    description: "Absolute or relative error allowed in float comparison mode.",
    type: "number",
    default: 1e-6,
    min: 0,
    max: 1,
  },
  "runner.maxConcurrency": {
    section: "Runner",
    label: "Parallel tests",
    type: "number",
    default: 4,
    min: 1,
    max: 32,
  },
  "runner.outputLimitKb": {
    section: "Runner",
    label: "Output limit (KB)",
    description: "Programs printing more than this are stopped with OLE.",
    type: "number",
    default: 4096,
    min: 16,
    max: 262144,
  },

  // Keyboard
  keybindings: {
    section: "Keyboard",
    label: "Keyboard shortcuts",
    description: "Overrides of default shortcuts (command id → keys, empty = unbound). Edit in the Keyboard Shortcuts panel.",
    type: "record",
    default: {},
    hidden: true,
  },

  // Plugins
  "plugins.disabled": {
    section: "Plugins",
    label: "Disabled plugins",
    description: "Plugin ids that should not be activated. Reload to apply.",
    type: "stringList",
    default: [],
  },
});

export type CoreSettings = SettingValues<typeof coreSettings>;
export type CoreSettingKey = keyof CoreSettings;
