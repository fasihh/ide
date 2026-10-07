import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

// Bundle Monaco locally (the default loader pulls it from a CDN) — the IDE works offline.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export { monaco };

const canvas = document.createElement("canvas");
canvas.width = canvas.height = 1;
const c2d = canvas.getContext("2d", { willReadFrequently: true })!;

/** Resolve a CSS color variable (oklch etc.) to #rrggbb, which Monaco themes require. */
function cssVarHex(name: string, fallback: string): string {
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
