import { ChevronDown, FilePlus2, Loader2, Play, Zap } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Kbd,
  cn,
} from "@cp-ide/ui";
import { NewProblemDialog } from "./NewProblemDialog.tsx";

// ---- toolbar ----

export function NewMenu({ ctx }: PanelProps) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            New <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onSelect={() => ctx.commands.execute("workspace.newScratch")}>
            <Zap /> Scratch problem <DropdownMenuShortcut>Alt+N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => ctx.commands.execute("workspace.newProblem")}>
            <FilePlus2 /> Problem… <DropdownMenuShortcut>Alt+Shift+N</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewProblemDialog ctx={ctx} />
    </>
  );
}

export function RunButton({ ctx }: PanelProps) {
  const phase = ctx.runner.use((s) => s.phase);
  const hasProblem = ctx.workspace.use((s) => !!s.problem);
  return (
    <Button size="sm" className="min-w-24" disabled={!hasProblem || phase !== "idle"} onClick={() => ctx.runner.run()}>
      {phase === "idle" ? <Play /> : <Loader2 className="animate-spin" />}
      {phase === "compiling" ? "Compiling" : phase === "running" ? "Running" : "Run"}
      <Kbd className="border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80">Ctrl+↵</Kbd>
    </Button>
  );
}

// ---- status bar ----

export function LanguageStatus({ ctx }: PanelProps) {
  const language = ctx.workspace.use((s) => s.problem?.meta.language);
  const std = ctx.settings.use("cpp.standard");
  const flags = ctx.settings.use("cpp.flags");
  const py = ctx.settings.use("python.interpreter");
  if (!language) return null;
  return (
    <button className="cursor-pointer font-mono hover:text-foreground" title="Open settings" onClick={() => ctx.commands.execute("settings.open")}>
      {language === "cpp" ? `C++ · ${std} ${flags}` : `Python · ${py}`}
    </button>
  );
}

export function TestsStatus({ ctx }: PanelProps) {
  const tests = ctx.runner.use((s) => s.tests);
  const ids = ctx.workspace.use((s) => s.problem?.tests.map((t) => t.id).join(","));
  if (!ids) return null;
  const done = ids
    .split(",")
    .map((id) => tests[id])
    .filter((t) => t?.status === "done");
  if (!done.length) return null;
  const passed = done.filter((t) => t.status === "done" && (t.result.verdict === "AC" || t.result.verdict === "RAN")).length;
  return (
    <button className={cn("cursor-pointer font-medium", passed === done.length ? "text-verdict-ac" : "text-verdict-wa")} onClick={() => ctx.panels.open("core.tests")}>
      {passed}/{done.length} passed
    </button>
  );
}

export function SaveStatus({ ctx }: PanelProps) {
  const dirty = ctx.workspace.use((s) => Object.values(s.buffers).some((b) => b.content !== b.saved));
  const hasProblem = ctx.workspace.use((s) => !!s.problem);
  if (!hasProblem) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", dirty ? "bg-verdict-tle" : "bg-verdict-ac/70")} />
      {dirty ? "Unsaved" : "Saved"}
    </span>
  );
}

export function RootStatus({ ctx }: PanelProps) {
  const root = ctx.settings.use("problems.root");
  return (
    <span className="truncate font-mono" title="Problems root">
      {root}
    </span>
  );
}
