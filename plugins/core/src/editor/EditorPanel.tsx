import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { FilePlus2, Zap } from "lucide-react";
import type { PanelProps, WebPluginContext } from "@cp-ide/plugin-api/web";
import { Button, Kbd, cn } from "@cp-ide/ui";
import { defineThemes, monaco } from "./monaco.ts";
import { parseDiagnostics } from "./diagnostics.ts";

type CodeEditor = monaco.editor.IStandaloneCodeEditor;

/** The mounted editor, shared with commands such as `editor.revealLine`. */
let current: CodeEditor | null = null;

const LANGUAGE_BY_EXT: Record<string, string> = {
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "cpp",
  hpp: "cpp",
  py: "python",
  md: "markdown",
};

function languageOf(file: string) {
  return LANGUAGE_BY_EXT[file.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
}

export function revealLine(line: number, column = 1) {
  if (!current) return;
  current.revealLineInCenter(line);
  current.setPosition({ lineNumber: line, column });
  current.focus();
}

export function focusEditor() {
  current?.focus();
}

/** Show compiler diagnostics as squiggles in the main file. */
export function installDiagnostics(ctx: WebPluginContext) {
  const apply = (stderr: string) => {
    const { problem } = ctx.workspace.get();
    const model = current?.getModel();
    if (!problem || !model || !model.uri.path.endsWith(`/${problem.meta.mainFile}`)) return;
    const markers = parseDiagnostics(stderr, problem.meta.mainFile)
      .filter((d) => d.severity !== "note")
      .map<monaco.editor.IMarkerData>((d) => ({
        startLineNumber: d.line,
        startColumn: d.column,
        endLineNumber: d.line,
        endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
        message: d.message,
        severity: d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      }));
    monaco.editor.setModelMarkers(model, "compiler", markers);
  };
  ctx.events.on("run:compiled", ({ result }) => apply(result.stderr));
  // Python runtime errors point at a line too.
  ctx.events.on("run:test-finished", ({ result }) => {
    if (result.verdict === "RE" && result.stderr) apply(result.stderr);
  });
}

function EmptyState({ ctx }: PanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-xs text-muted-foreground">
      <div className="text-sm text-foreground">No problem open</div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => ctx.commands.execute("workspace.newScratch")}>
          <Zap /> Scratch problem <Kbd>Alt+N</Kbd>
        </Button>
        <Button variant="outline" onClick={() => ctx.commands.execute("workspace.newProblem")}>
          <FilePlus2 /> New problem <Kbd>Alt+Shift+N</Kbd>
        </Button>
      </div>
      <div>…or pick one from the explorer.</div>
    </div>
  );
}

export function EditorPanel({ ctx }: PanelProps) {
  const problem = ctx.workspace.use((s) => s.problem);
  const activeFile = ctx.workspace.use((s) => s.activeFile);
  const buffers = ctx.workspace.use((s) => s.buffers);
  const theme = ctx.theme.use();
  const fontFamily = ctx.settings.use("editor.fontFamily");
  const fontSize = ctx.settings.use("editor.fontSize");
  const fontLigatures = ctx.settings.use("editor.fontLigatures");
  const tabSize = ctx.settings.use("editor.tabSize");
  const wordWrap = ctx.settings.use("editor.wordWrap");
  const minimap = ctx.settings.use("editor.minimap");
  const lineNumbers = ctx.settings.use("editor.lineNumbers");
  const editorRef = useRef<CodeEditor | null>(null);

  useEffect(() => {
    monaco.editor.setTheme(defineThemes());
  }, [theme]);

  useEffect(
    () => () => {
      if (current === editorRef.current) current = null;
    },
    [],
  );

  if (!problem || !activeFile) return <EmptyState ctx={ctx} />;
  const buffer = buffers[activeFile];
  const files = Object.keys(buffers);

  return (
    <div className="flex h-full flex-col">
      {files.length > 1 && (
        <div className="flex shrink-0 gap-px border-b px-1 pt-1">
          {files.map((f) => {
            const dirty = buffers[f]!.content !== buffers[f]!.saved;
            return (
              <button
                key={f}
                onClick={() => ctx.workspace.setActiveFile(f)}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-t px-2.5 py-1 font-mono text-[11px]",
                  f === activeFile ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
                {dirty && <span className="size-1.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Editor
          path={`${problem.id}/${activeFile}`}
          language={languageOf(activeFile)}
          value={buffer?.content ?? ""}
          theme={theme === "dark" ? "cp-dark" : "cp-light"}
          beforeMount={() => defineThemes()}
          onMount={(editor) => {
            editorRef.current = editor;
            current = editor;
            editor.onDidFocusEditorText(() => (current = editor));
            editor.focus();
          }}
          onChange={(value) => ctx.workspace.setBuffer(activeFile, value ?? "")}
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
            fixedOverflowWidgets: true,
            bracketPairColorization: { enabled: true },
            renderWhitespace: "selection",
            stickyScroll: { enabled: false },
          }}
        />
      </div>
    </div>
  );
}
