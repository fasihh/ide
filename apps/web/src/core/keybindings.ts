import { useMemo } from "react";
import type { CommandInfo } from "@cp-ide/plugin-api/web";
import { useRegistry } from "./registry.ts";
import { reportError } from "./notify.ts";
import { getSetting, updateSettings, useSetting } from "./settings.ts";

const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  escape: "esc",
  return: "enter",
  cmd: "ctrl",
  meta: "ctrl",
  control: "ctrl",
  option: "alt",
};
const MODIFIERS = ["ctrl", "shift", "alt"];

/** "Ctrl+Shift+P" → "ctrl+shift+p" with modifiers in a fixed order. */
export function normalizeKeybinding(binding: string): string {
  const parts = binding.toLowerCase().split("+").map((p) => KEY_ALIASES[p.trim()] ?? p.trim());
  const mods = MODIFIERS.filter((m) => parts.includes(m));
  const key = parts.filter((p) => !MODIFIERS.includes(p)).join("+");
  return [...mods, key].join("+");
}

function eventToKeybinding(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(key)) return null;
  // With Shift held, e.key is the shifted character ("+" / "?"); e.code keeps it stable.
  const base = e.shiftKey && /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.shiftKey && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : key;
  const mods = [e.ctrlKey || e.metaKey ? "ctrl" : "", e.shiftKey ? "shift" : "", e.altKey ? "alt" : ""].filter(Boolean);
  return [...mods, KEY_ALIASES[base] ?? base].join("+");
}

/** Pretty label for display, e.g. "Ctrl+Enter". */
export function formatKeybinding(binding: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const pretty: Record<string, string> = { enter: "Enter", esc: "Esc", space: "Space", up: "↑", down: "↓", left: "←", right: "→" };
  return normalizeKeybinding(binding)
    .split("+")
    .map((p) => (p === "ctrl" && isMac ? "⌘" : (pretty[p] ?? (p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))))
    .join(isMac ? "" : "+");
}

/** Commands with user overrides (`keybindings` setting) applied. */
function resolve(commands: ReturnType<typeof useRegistry.getState>["commands"], overrides: Record<string, string>): CommandInfo[] {
  return commands.map(({ owner, ...c }) => ({
    ...c,
    pluginId: owner.pluginId,
    defaultKeybinding: c.keybinding,
    keybinding: c.id in overrides ? overrides[c.id] || undefined : c.keybinding,
  }));
}

export function listCommands(): CommandInfo[] {
  return resolve(useRegistry.getState().commands, getSetting("keybindings"));
}

export function useCommandList(): CommandInfo[] {
  const commands = useRegistry((s) => s.commands);
  const overrides = useSetting("keybindings");
  return useMemo(() => resolve(commands, overrides), [commands, overrides]);
}

export async function setKeybinding(id: string, binding: string | null) {
  const next = { ...getSetting("keybindings") };
  if (binding === null) delete next[id];
  else next[id] = binding && normalizeKeybinding(binding);
  await updateSettings({ keybindings: next });
}

let recorder: ((binding: string | undefined) => void) | null = null;

/** Resolve with the next key combination pressed (Esc → undefined). Global bindings are paused meanwhile. */
export function recordKeybinding(): Promise<string | undefined> {
  recorder?.(undefined);
  return new Promise((resolve) => {
    recorder = (b) => {
      recorder = null;
      resolve(b);
    };
  });
}

/**
 * Global keybindings. Listening in the capture phase lets commands win over Monaco's
 * own bindings (e.g. Ctrl+Enter) without the editor needing to know about them.
 */
export function installKeybindings() {
  const handler = (e: KeyboardEvent) => {
    const pressed = eventToKeybinding(e);
    if (!pressed) return;
    if (recorder) {
      e.preventDefault();
      e.stopPropagation();
      recorder(pressed === "esc" ? undefined : pressed);
      return;
    }
    const cmd = listCommands().find((c) => c.keybinding && normalizeKeybinding(c.keybinding) === pressed);
    if (!cmd) return;
    e.preventDefault();
    e.stopPropagation();
    Promise.resolve()
      .then(() => cmd.run())
      .catch(reportError(`Command failed: ${cmd.title}`));
  };
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}
