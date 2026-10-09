import type { LucideIcon } from "lucide-react";
import { Download, FileInput, Loader2, MoreHorizontal, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Fragment, useState } from "react";
import type { PanelProps, WebPluginContext } from "@cp-ide/plugin-api/web";
import { CodeEditor, fileModelPath } from "@cp-ide/editor";
import { libraryNameSchema } from "@cp-ide/shared";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  cn,
} from "@cp-ide/ui";
import { focusTerminal } from "./TerminalPanel.tsx";
import {
  activeFile,
  createFile,
  deleteFile,
  moveFile,
  renameFile,
  runSource,
  saveFile,
  setActive,
  setContent,
  usePlayground,
} from "./store.ts";

const TAB_DRAG_TYPE = "application/x-cp-ide-playground-tab";

const validName = (names: string[], v: string, except?: string) => {
  const res = libraryNameSchema.safeParse(v);
  if (!res.success) return "Use a name like test.cpp or try.py";
  if (v !== except && names.includes(v)) return "A file with that name exists";
  return undefined;
};

export async function newPlaygroundFile(ctx: WebPluginContext) {
  const names = usePlayground.getState().files.map((f) => f.name);
  let n = 1;
  while (names.includes(`scratch${n}.cpp`)) n++;
  const name = await ctx.ui.prompt({ title: "New playground file (.cpp or .py)", value: `scratch${n}.cpp`, validate: (v) => validName(names, v) });
  if (!name) return;
  try {
    await createFile(name);
  } catch (e) {
    return ctx.notify.error("Could not create file", String((e as Error)?.message ?? e));
  }
  // From the palette or the New menu the Playground may be hidden behind the Code tab.
  ctx.panels.open("playground.editor");
}

async function renamePlaygroundFile(ctx: WebPluginContext, from: string) {
  const names = usePlayground.getState().files.map((f) => f.name);
  const to = await ctx.ui.prompt({ title: `Rename ${from}`, value: from, validate: (v) => validName(names, v, from) });
  if (to && to !== from) await renameFile(from, to).catch((e) => ctx.notify.error("Could not rename", String(e?.message ?? e)));
}

async function deletePlaygroundFile(ctx: WebPluginContext, name: string) {
  const unsaved = usePlayground.getState().files.some((f) => f.name === name && f.content !== f.saved);
  const ok = await ctx.ui.confirm({
    title: `Delete ${name}?`,
    message: unsaved
      ? "This file has changes that are not saved yet. It will be permanently removed from the playground folder."
      : "The file will be permanently removed from the playground folder.",
    confirmLabel: "Delete",
    destructive: true,
    // Unsaved work is always worth asking about.
    rememberKey: unsaved ? undefined : "playground.delete",
  });
  if (ok) await deleteFile(name).catch((e) => ctx.notify.error("Could not delete", String(e?.message ?? e)));
}

export async function runPlayground(ctx: WebPluginContext) {
  const f = activeFile();
  if (!f) return;
  await saveFile(f.name);
  ctx.panels.open("playground.terminal");
  runSource(f.name, f.content);
  setTimeout(focusTerminal, 50);
}

/** The named file, or the active one when no name is given (palette commands). */
const fileNamed = (name?: string) => (name ? usePlayground.getState().files.find((f) => f.name === name) : activeFile());

/** Turn the current playground file into a problem (tests and all the problem tooling). */
export async function saveAsProblem(ctx: WebPluginContext, name?: string) {
  const f = fileNamed(name);
  if (!f) return;
  const problemName = await ctx.ui.prompt({
    title: "Save as problem — name",
    value: f.name.replace(/\.(cpp|py)$/, ""),
    validate: (v) => (!v.trim() ? "Enter a name" : undefined),
  });
  if (!problemName?.trim()) return;
  try {
    // Starts in Playground mode: Run keeps running it in the terminal; tests can be added later.
    const problem = await ctx.workspace.createProblem({ name: problemName.trim(), platform: "custom", group: "playground", language: f.language, runMode: "playground" });
    ctx.workspace.setBuffer(problem.meta.mainFile, f.content);
    await ctx.workspace.save(problem.meta.mainFile);
    ctx.panels.open("core.editor");
    ctx.notify.success(`Saved as problem "${problemName.trim()}"`, `custom / playground — ${problem.id}`);
  } catch (e) {
    ctx.notify.error("Could not create problem", String((e as Error)?.message ?? e));
  }
}

export function downloadPlaygroundFile(name?: string) {
  const f = fileNamed(name);
  if (!f) return;
  const url = URL.createObjectURL(new Blob([f.content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface FileAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  destructive?: boolean;
  /** Draws a separator above the item. */
  group?: boolean;
}

/** The actions for one file; the "…" button and a tab's right-click menu both render this list. */
const fileActions = (ctx: WebPluginContext, name: string): FileAction[] => [
  { id: "save", label: "Save now", icon: Save, run: () => void saveFile(name) },
  { id: "saveAsProblem", label: "Save as problem…", icon: FileInput, run: () => void saveAsProblem(ctx, name) },
  { id: "download", label: "Download file", icon: Download, run: () => downloadPlaygroundFile(name) },
  { id: "rename", label: "Rename…", icon: Pencil, run: () => void renamePlaygroundFile(ctx, name), group: true },
  { id: "delete", label: "Delete", icon: Trash2, run: () => void deletePlaygroundFile(ctx, name), destructive: true },
];

export function PlaygroundPanel({ ctx }: PanelProps) {
  const loaded = usePlayground((s) => s.loaded);
  const files = usePlayground((s) => s.files);
  const active = usePlayground((s) => s.active);
  const folder = usePlayground((s) => s.folder);
  const busy = usePlayground((s) => s.run.phase === "running" || s.run.phase === "compiling");
  const runKey = ctx.commands.useList().find((c) => c.id === "run.primary")?.keybinding;
  const file = files.find((f) => f.name === active);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The tab a dragged tab would land before; "" means the end of the row. */
  const [dropBefore, setDropBefore] = useState<string | null>(null);

  if (!loaded) return <div className="p-4 text-xs text-muted-foreground">Loading playground…</div>;

  return (
    <div data-playground-root className="@container flex h-full flex-col">
      <div className="flex shrink-0 items-end gap-1 border-b pt-1 pr-1">
        <div className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto pl-1">
          {files.map((f) => {
            const dirty = f.content !== f.saved;
            return (
              <ContextMenu key={f.name}>
                <ContextMenuTrigger asChild>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TAB_DRAG_TYPE, f.name);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(f.name);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropBefore(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      setDropBefore(f.name);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging && dragging !== f.name) moveFile(dragging, f.name);
                      setDragging(null);
                      setDropBefore(null);
                    }}
                    onClick={() => setActive(f.name)}
                    onDoubleClick={() => renamePlaygroundFile(ctx, f.name)}
                    title={`${f.name} — double-click to rename, right-click for actions`}
                    className={cn(
                      "group flex cursor-pointer items-center gap-1.5 rounded-t border-l-2 border-transparent px-2.5 py-1 font-mono text-[0.6875rem] whitespace-nowrap select-none",
                      f.name === active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                      dragging && dropBefore === f.name && dragging !== f.name && "border-primary",
                      dragging === f.name && "opacity-50",
                    )}
                  >
                    {f.name}
                    {/* The unsaved dot and the close button share a slot so the tab does not change width on hover. */}
                    <span className="relative flex size-3.5 items-center justify-center">
                      {dirty && <span className="size-1.5 rounded-full bg-primary group-hover:hidden" />}
                      <button
                        aria-label={`Delete ${f.name}`}
                        title="Delete file"
                        className="absolute inset-0 hidden cursor-pointer items-center justify-center rounded-sm hover:bg-accent group-hover:flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deletePlaygroundFile(ctx, f.name);
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel className="max-w-64 truncate" title={folder}>
                    Saved in {folder}
                  </ContextMenuLabel>
                  {fileActions(ctx, f.name).map((a) => (
                    <Fragment key={a.id}>
                      {a.group && <ContextMenuSeparator />}
                      <ContextMenuItem variant={a.destructive ? "destructive" : undefined} onSelect={a.run}>
                        <a.icon /> {a.label}
                      </ContextMenuItem>
                    </Fragment>
                  ))}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          <div
            className={cn("h-5 w-3 shrink-0 border-l-2 border-transparent", dragging && dropBefore === "" && "border-primary")}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setDropBefore("");
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) moveFile(dragging, null);
              setDragging(null);
              setDropBefore(null);
            }}
          />
          <Tooltip content="New playground file">
            <button
              className="mb-0.5 ml-1 flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => newPlaygroundFile(ctx)}
            >
              <Plus className="size-3.5" />
            </button>
          </Tooltip>
        </div>
        <div className="mb-0.5 flex shrink-0 items-center gap-1">
          <span className="hidden px-1 text-[0.625rem] text-muted-foreground @[30rem]:inline">
            Run with the top bar{runKey ? ` or ${ctx.commands.formatKeybinding(runKey)}` : ""}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Playground actions" disabled={!file}>
                {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="max-w-64 truncate" title={folder}>
                Saved in {folder}
              </DropdownMenuLabel>
              {file &&
                fileActions(ctx, file.name).map((a) => (
                  <Fragment key={a.id}>
                    {a.group && <DropdownMenuSeparator />}
                    <DropdownMenuItem className={a.destructive ? "text-destructive focus:text-destructive" : undefined} onSelect={a.run}>
                      <a.icon /> {a.label}
                    </DropdownMenuItem>
                  </Fragment>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {file ? (
        <CodeEditor
          ctx={ctx}
          className="min-h-0 flex-1"
          path={fileModelPath(`${folder}/${file.name}`)}
          language={file.language}
          value={file.content}
          onChange={(v) => setContent(file.name, v)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">No files — create one with +</div>
      )}
    </div>
  );
}
