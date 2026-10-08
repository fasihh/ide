import { useEffect, useRef } from "react";
import { Check, ChevronDown, FilePlus2, Keyboard, Plus, X, Zap } from "lucide-react";
import type { PanelProps, WebPluginContext } from "@cp-ide/plugin-api/web";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Tooltip,
  cn,
} from "@cp-ide/ui";
import { CodeEditor as CodeEditorView, type MonacoEditor, fileModelPath, monaco } from "@cp-ide/editor";
import { parseDiagnostics } from "./diagnostics.ts";

type CodeEditor = MonacoEditor;

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

/** The last focused code editor (not the library editor). */
export function currentEditor() {
  return current;
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

const FILE_NAME = /^[\w.-]+\.(cpp|cc|cxx|h|hpp|py|txt|in|out|ans|md)$/i;

export async function newFile(ctx: WebPluginContext, suggestion = "brute.cpp") {
  const { problem, buffers } = ctx.workspace.get();
  if (!problem) return;
  const name = await ctx.ui.prompt({
    title: "New file",
    placeholder: "brute.cpp, gen.py, 1.in …",
    value: suggestion,
    validate: (v) => (!FILE_NAME.test(v) ? "Use a name like brute.cpp, gen.py or 1.in" : buffers[v] ? "File already exists" : undefined),
  });
  if (name) await ctx.workspace.createFile(name).catch((e) => ctx.notify.error("Could not create file", String(e?.message ?? e)));
}

export async function renameFile(ctx: WebPluginContext, file?: string) {
  const { problem, buffers, activeFile } = ctx.workspace.get();
  const from = file ?? activeFile;
  if (!problem || !from) return;
  const to = await ctx.ui.prompt({
    title: `Rename ${from}`,
    value: from,
    validate: (v) => (!FILE_NAME.test(v) ? "Invalid file name" : v !== from && buffers[v] ? "File already exists" : undefined),
  });
  if (to && to !== from) await ctx.workspace.renameFile(from, to).catch((e) => ctx.notify.error("Could not rename file", String(e?.message ?? e)));
}

export async function deleteFile(ctx: WebPluginContext, file?: string) {
  const { problem, activeFile } = ctx.workspace.get();
  const name = file ?? activeFile;
  if (!problem || !name) return;
  if (name === problem.meta.mainFile) return ctx.notify.error("The main file can't be deleted");
  const ok = await ctx.ui.confirm({ title: `Delete ${name}?`, message: "The file is removed from the problem folder.", confirmLabel: "Delete", destructive: true });
  if (ok) await ctx.workspace.deleteFile(name).catch((e) => ctx.notify.error("Could not delete file", String(e?.message ?? e)));
}

const EDITING_MODES = [
  { id: "default", label: "Default", description: "Standard editor keys" },
  { id: "vim", label: "Vim", description: "Modal editing" },
] as const;

/** Right end of the tab bar: pick the editing mode (same setting as Settings → Editor → Vim mode). */
function EditingModeMenu({ ctx }: { ctx: WebPluginContext }) {
  const vim = ctx.settings.use("editor.vimMode");
  const current = vim ? "vim" : "default";
  return (
    <DropdownMenu>
      <Tooltip content="Editing mode">
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "mb-0.5 flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-[0.6875rem] hover:bg-accent",
              vim ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Keyboard className="size-3.5" />
            {vim ? "Vim" : "Default"}
            <ChevronDown className="size-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Editing mode</DropdownMenuLabel>
        {EDITING_MODES.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => ctx.settings.set("editor.vimMode", m.id === "vim")}>
            <Check className={cn(current === m.id ? "opacity-100" : "opacity-0")} />
            <div>
              <div>{m.label}</div>
              <div className="text-[0.625rem] text-muted-foreground">{m.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => ctx.commands.execute("settings.open")}>Editor settings…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FileTabs({ ctx, files, activeFile }: { ctx: WebPluginContext; files: string[]; activeFile: string }) {
  const buffers = ctx.workspace.use((s) => s.buffers);
  const mainFile = ctx.workspace.use((s) => s.problem?.meta.mainFile);
  return (
    <div className="flex shrink-0 items-end gap-1 border-b pt-1 pr-1">
      <div className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto pl-1">
      {files.map((f) => {
        const b = buffers[f];
        const dirty = b && b.content !== b.saved;
        return (
          <div
            key={f}
            onClick={() => ctx.workspace.setActiveFile(f)}
            onDoubleClick={() => renameFile(ctx, f)}
            onAuxClick={(e) => e.button === 1 && f !== mainFile && deleteFile(ctx, f)}
            title={f === mainFile ? `${f} (main file) — double-click to rename` : `${f} — double-click to rename`}
            className={cn(
              "group flex cursor-pointer items-center gap-1.5 rounded-t py-1 pr-1.5 pl-2.5 font-mono text-[0.6875rem] whitespace-nowrap select-none",
              f === activeFile ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
            {f === mainFile && <span className="text-[0.5625rem] text-primary">main</span>}
            {f !== mainFile ? (
              <button
                aria-label={`Delete ${f}`}
                className="flex size-3.5 items-center justify-center rounded-sm opacity-0 group-hover:opacity-70 hover:bg-accent hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteFile(ctx, f);
                }}
              >
                {dirty ? <span className="size-1.5 rounded-full bg-primary group-hover:hidden" /> : null}
                <X className={cn("size-3", dirty && "hidden group-hover:block")} />
              </button>
            ) : (
              <span className="flex size-3.5 items-center justify-center">{dirty && <span className="size-1.5 rounded-full bg-primary" />}</span>
            )}
          </div>
        );
      })}
      <Tooltip content="New file (brute force, generator, extra input…)">
        <button className="mb-0.5 ml-1 flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => newFile(ctx)}>
          <Plus className="size-3.5" />
        </button>
      </Tooltip>
      </div>
      <EditingModeMenu ctx={ctx} />
    </div>
  );
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
  const problemsRoot = ctx.workspace.use((s) => s.problemsRoot);
  const activeFile = ctx.workspace.use((s) => s.activeFile);
  const buffers = ctx.workspace.use((s) => s.buffers);
  const editorRef = useRef<CodeEditor | null>(null);

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
      <FileTabs ctx={ctx} files={files} activeFile={activeFile} />
      <CodeEditorView
        ctx={ctx}
        className="min-h-0 flex-1"
        path={fileModelPath(`${problemsRoot}/${problem.id}/${activeFile}`)}
        language={languageOf(activeFile)}
        value={buffer?.content ?? ""}
        onMount={(editor) => {
          editorRef.current = editor;
          current = editor;
          editor.onDidFocusEditorText(() => (current = editor));
          editor.focus();
        }}
        onChange={(value) => ctx.workspace.setBuffer(activeFile, value)}
      />
    </div>
  );
}
