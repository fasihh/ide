/// <reference path="./vite-env.d.ts" />
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

// Bundle Monaco locally (the default loader pulls it from a CDN) — the IDE works offline.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export { monaco };

let overflowHost: HTMLElement | null = null;

/**
 * Container for Monaco's floating widgets (suggestions, hovers, parameter hints), attached to
 * <body>. dockview panels sit in overlays with `transform`/`contain`, which makes them the
 * containing block for `position: fixed` — so with `fixedOverflowWidgets` alone the widgets are
 * offset by the panel's position and clipped at its edges. The `monaco-editor` class gives the
 * host Monaco's theme variables.
 */
export function overflowWidgetsHost(): HTMLElement {
  if (!overflowHost) {
    overflowHost = document.createElement("div");
    overflowHost.className = "monaco-editor cp-monaco-overflow";
    Object.assign(overflowHost.style, { position: "absolute", top: "0", left: "0", width: "0", height: "0", zIndex: "40" });
    overflowHost.addEventListener("keydown", forwardRenameKeys);
    document.body.appendChild(overflowHost);
  }
  return overflowHost;
}

/** The editor that last had text focus — the owner of a focused widget in the overflow host. */
let lastFocusedEditor: monaco.editor.ICodeEditor | null = null;
monaco.editor.onDidCreateEditor((editor) => editor.onDidFocusEditorText(() => (lastFocusedEditor = editor)));

/**
 * The rename box is the one overflow widget that takes keyboard focus. Monaco listens for keybindings
 * on the editor's own container, so Enter / Escape typed in a box living here never reach it.
 */
function forwardRenameKeys(e: KeyboardEvent) {
  if (!(e.target instanceof HTMLElement) || !e.target.closest(".rename-box") || !lastFocusedEditor) return;
  const command = e.key === "Enter" ? "acceptRenameInput" : e.key === "Escape" ? "cancelRenameInput" : null;
  if (!command) return;
  e.preventDefault();
  e.stopPropagation();
  lastFocusedEditor.trigger("keyboard", command, {});
  if (command === "cancelRenameInput") lastFocusedEditor.focus();
}

const canvas = document.createElement("canvas");
canvas.width = canvas.height = 1;
const c2d = canvas.getContext("2d", { willReadFrequently: true })!;

/** Resolve a CSS color variable (oklch etc.) to #rrggbb, which Monaco themes require. */
export function cssVarHex(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return fallback;
  c2d.clearRect(0, 0, 1, 1);
  c2d.fillStyle = fallback;
  c2d.fillStyle = value;
  c2d.fillRect(0, 0, 1, 1);
  const [r, g, b] = c2d.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((x) => x!.toString(16).padStart(2, "0")).join("")}`;
}

/** (Re)define the cp themes from the current CSS tokens so the editor blends into its panel. */
export function defineThemes() {
  const isDark = document.documentElement.classList.contains("dark");
  const colors = {
    "editor.background": cssVarHex("--panel", isDark ? "#18181b" : "#ffffff"),
    "editorGutter.background": cssVarHex("--panel", isDark ? "#18181b" : "#ffffff"),
    "editor.lineHighlightBackground": `${cssVarHex("--muted", isDark ? "#27272a" : "#f4f4f5")}80`,
    "editor.lineHighlightBorder": "#00000000",
    "editorWidget.background": cssVarHex("--popover", isDark ? "#1f1f23" : "#ffffff"),
    "editorWidget.border": cssVarHex("--border", isDark ? "#2e2e33" : "#e4e4e7"),
  };
  monaco.editor.defineTheme(isDark ? "cp-dark" : "cp-light", {
    base: isDark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors,
  });
  return isDark ? "cp-dark" : "cp-light";
}

/** The code editor that has keyboard focus, if any (for app commands that act on "the current editor"). */
export const focusedEditor = () => monaco.editor.getEditors().find((e) => e.hasTextFocus());
