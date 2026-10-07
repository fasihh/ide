import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import type { WebPluginContext } from "@cp-ide/plugin-api/web";
import { cn } from "@cp-ide/ui";
import { defineThemes, monaco, overflowWidgetsHost } from "./monaco.ts";

export type MonacoEditor = monaco.editor.IStandaloneCodeEditor;

/** Colours for the Vim mode pill (Zed-style): normal = blue, insert = green, visual = purple, replace = red. */
const VIM_MODE_CLASS: Record<string, string> = {
  normal: "bg-primary/15 text-primary",
  insert: "bg-verdict-ac/15 text-verdict-ac",
  visual: "bg-verdict-re/15 text-verdict-re",
  replace: "bg-verdict-wa/15 text-verdict-wa",
};
const PILL = "mr-2 inline-block rounded px-1.5 font-sans text-[0.625rem] leading-4 font-semibold tracking-wider";

/** Attach monaco-vim while `enabled`; the status line (mode pill, `:` commands, pending keys) renders into `statusRef`. */
function useVim(editor: MonacoEditor | null, enabled: boolean, statusRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!editor || !enabled || !statusRef.current) return;
    let disposed = false;
    let vim: { dispose(): void } | null = null;
    void import("monaco-vim").then(({ initVimMode, StatusBar }) => {
      if (disposed) return;
      // Render the mode as a coloured pill instead of "--NORMAL--" text.
      class ColoredStatusBar extends StatusBar {
        setMode(ev: { mode: string; subMode?: string }) {
          const label =
            ev.mode === "visual"
              ? ev.subMode === "linewise"
                ? "VISUAL LINE"
                : ev.subMode === "blockwise"
                  ? "VISUAL BLOCK"
                  : "VISUAL"
              : ev.mode.toUpperCase();
          const node = (this as unknown as { modeInfoNode: HTMLElement }).modeInfoNode;
          node.textContent = label;
          node.className = cn(PILL, VIM_MODE_CLASS[ev.mode] ?? VIM_MODE_CLASS.normal);
        }
      }
      vim = initVimMode(editor, statusRef.current, ColoredStatusBar);
    });
    return () => {
      disposed = true;
      vim?.dispose();
      if (statusRef.current) statusRef.current.textContent = "";
    };
  }, [editor, enabled, statusRef]);
}

export type CodeEditorProps = {
  ctx: WebPluginContext;
  /** Model path — one model (and undo history) per path. */
  path: string;
  language: string;
  value: string;
  onChange?: (value: string) => void;
  onMount?: (editor: MonacoEditor) => void;
  /** Extra Monaco options; the user's editor settings are applied underneath. */
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  /** Follow the `editor.vimMode` setting (default true). */
  vim?: boolean;
  className?: string;
};

/**
 * Monaco with the user's editor settings (font, tabs, wrap, minimap, line numbers), the app theme,
 * Vim mode, and floating widgets that work inside dock panels. Use this in plugins instead of
 * wiring `@monaco-editor/react` by hand.
 */
export function CodeEditor({ ctx, path, language, value, onChange, onMount, options, vim = true, className }: CodeEditorProps) {
  const theme = ctx.theme.use();
  const fontFamily = ctx.settings.use("editor.fontFamily");
  const fontSize = ctx.settings.use("editor.fontSize");
  const fontLigatures = ctx.settings.use("editor.fontLigatures");
  const tabSize = ctx.settings.use("editor.tabSize");
  const wordWrap = ctx.settings.use("editor.wordWrap");
  const minimap = ctx.settings.use("editor.minimap");
  const lineNumbers = ctx.settings.use("editor.lineNumbers");
  const vimSetting = ctx.settings.use("editor.vimMode");
  const vimMode = vim && vimSetting;
  const [editor, setEditor] = useState<MonacoEditor | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  useVim(editor, vimMode, statusRef);

  useEffect(() => {
    monaco.editor.setTheme(defineThemes());
  }, [theme]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1">
        <Editor
          path={path}
          language={language}
          value={value}
          theme={theme === "dark" ? "cp-dark" : "cp-light"}
          beforeMount={() => defineThemes()}
          onMount={(e) => {
            setEditor(e);
            onMount?.(e);
          }}
          onChange={(v) => onChange?.(v ?? "")}
          loading={<div className="p-4 text-xs text-muted-foreground">Loading editor…</div>}
          options={{
            fontFamily,
            fontSize,
            fontLigatures,
            tabSize,
            wordWrap: wordWrap ? "on" : "off",
            minimap: { enabled: minimap },
            lineNumbers,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8 },
            smoothScrolling: true,
            cursorBlinking: "smooth",
            bracketPairColorization: { enabled: true },
            renderWhitespace: "selection",
            stickyScroll: { enabled: false },
            ...options,
            // dock panels are transformed; widgets must live outside them (see monaco.ts)
            fixedOverflowWidgets: true,
            overflowWidgetsDomNode: overflowWidgetsHost(),
          }}
        />
      </div>
      {vimMode && (
        <div
          ref={statusRef}
          className="h-6 shrink-0 border-t px-2 font-mono text-[0.6875rem] leading-6 text-muted-foreground [&_input]:bg-transparent [&_input]:text-foreground [&_input]:outline-none"
        />
      )}
    </div>
  );
}
