import { Download, FileInput, Loader2, MoreHorizontal, Pencil, Plus, Save, Trash2 } from "lucide-react";
import type { PanelProps, WebPluginContext } from "@cp-ide/plugin-api/web";
import { CodeEditor, fileModelPath } from "@cp-ide/editor";
import { libraryNameSchema } from "@cp-ide/shared";
import {
  Button,
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
  renameFile,
  runSource,
  saveFile,
  setActive,
  setContent,
  usePlayground,
} from "./store.ts";

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
  const ok = await ctx.ui.confirm({ title: `Delete ${name}?`, message: "The file is removed from the playground folder.", confirmLabel: "Delete", destructive: true });
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

/** Turn the current playground file into a problem (tests and all the problem tooling). */
export async function saveAsProblem(ctx: WebPluginContext) {
  const f = activeFile();
  if (!f) return;
  const name = await ctx.ui.prompt({
    title: "Save as problem — name",
    value: f.name.replace(/\.(cpp|py)$/, ""),
    validate: (v) => (!v.trim() ? "Enter a name" : undefined),
  });
  if (!name?.trim()) return;
  try {
    // Starts in Playground mode: Run keeps running it in the terminal; tests can be added later.
    const problem = await ctx.workspace.createProblem({ name: name.trim(), platform: "custom", group: "playground", language: f.language, runMode: "playground" });
    ctx.workspace.setBuffer(problem.meta.mainFile, f.content);
    await ctx.workspace.save(problem.meta.mainFile);
    ctx.panels.open("core.editor");
    ctx.notify.success(`Saved as problem "${name.trim()}"`, `custom / playground — ${problem.id}`);
  } catch (e) {
    ctx.notify.error("Could not create problem", String((e as Error)?.message ?? e));
  }
}

export function downloadPlaygroundFile() {
  const f = activeFile();
  if (!f) return;
  const url = URL.createObjectURL(new Blob([f.content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PlaygroundPanel({ ctx }: PanelProps) {
  const loaded = usePlayground((s) => s.loaded);
  const files = usePlayground((s) => s.files);
  const active = usePlayground((s) => s.active);
  const folder = usePlayground((s) => s.folder);
  const busy = usePlayground((s) => s.run.phase === "running" || s.run.phase === "compiling");
  const runKey = ctx.commands.useList().find((c) => c.id === "run.primary")?.keybinding;
  const file = files.find((f) => f.name === active);

  if (!loaded) return <div className="p-4 text-xs text-muted-foreground">Loading playground…</div>;

  return (
    <div data-playground-root className="@container flex h-full flex-col">
      <div className="flex shrink-0 items-end gap-1 border-b pt-1 pr-1">
        <div className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto pl-1">
          {files.map((f) => {
            const dirty = f.content !== f.saved;
            return (
              <div
                key={f.name}
                onClick={() => setActive(f.name)}
                onDoubleClick={() => renamePlaygroundFile(ctx, f.name)}
                title={`${f.name} — double-click to rename`}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-t px-2.5 py-1 font-mono text-[0.6875rem] whitespace-nowrap select-none",
                  f.name === active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.name}
                {dirty && <span className="size-1.5 rounded-full bg-primary" />}
              </div>
            );
          })}
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
              <DropdownMenuItem onSelect={() => file && saveFile(file.name)}>
                <Save /> Save now
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => saveAsProblem(ctx)}>
                <FileInput /> Save as problem…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadPlaygroundFile}>
                <Download /> Download file
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => file && renamePlaygroundFile(ctx, file.name)}>
                <Pencil /> Rename…
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => file && deletePlaygroundFile(ctx, file.name)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
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
