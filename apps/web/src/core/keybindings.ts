import { useRegistry } from "./registry.ts";
import { reportError } from "./notify.ts";

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

/** "Ctrl+Shift+P" → "ctrl+shift+p" with modifiers in a fixed order. */
export function normalizeKeybinding(binding: string): string {
  const parts = binding.toLowerCase().split("+").map((p) => KEY_ALIASES[p.trim()] ?? p.trim());
  const mods = ["ctrl", "shift", "alt"].filter((m) => parts.includes(m));
  const key = parts.filter((p) => !["ctrl", "shift", "alt"].includes(p)).join("+");
  return [...mods, key].join("+");
}

function eventToKeybinding(e: KeyboardEvent): string | null {
  const key = e.key.toLowerCase();
  if (["control", "shift", "alt", "meta"].includes(key)) return null;
  const mods = [e.ctrlKey || e.metaKey ? "ctrl" : "", e.shiftKey ? "shift" : "", e.altKey ? "alt" : ""].filter(Boolean);
  return [...mods, KEY_ALIASES[key] ?? key].join("+");
}

/** Pretty label for display, e.g. "Ctrl+Enter". */
export function formatKeybinding(binding: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return normalizeKeybinding(binding)
    .split("+")
    .map((p) => (p === "ctrl" && isMac ? "⌘" : p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))
    .join(isMac ? "" : "+");
}

/**
 * Global keybindings. Listening in the capture phase lets commands win over Monaco's
 * own bindings (e.g. Ctrl+Enter) without the editor needing to know about them.
 */
export function installKeybindings() {
  const handler = (e: KeyboardEvent) => {
    const pressed = eventToKeybinding(e);
    if (!pressed) return;
    const cmd = useRegistry.getState().commands.find((c) => c.keybinding && normalizeKeybinding(c.keybinding) === pressed);
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
