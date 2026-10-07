import { useEffect, useState } from "react";
import { ExternalLink, FolderInput, Pencil, Trash2 } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import type { CompareMode, Language, ProblemMetaPatch, ProblemStatus } from "@cp-ide/shared";
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, cn } from "@cp-ide/ui";
import { deleteProblem, moveProblem, renameProblem } from "../explorer/actions.ts";
import { ModeSegmented } from "./ModeControl.tsx";

/** Text input that commits on blur / Enter instead of on every keystroke. */
function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function ProblemPanel({ ctx }: PanelProps) {
  const problem = ctx.workspace.use((s) => s.problem);
  const defaultTl = ctx.settings.use("runner.timeLimitMs");
  const defaultCompare = ctx.settings.use("runner.compareMode");
  const defaultEps = ctx.settings.use("runner.floatEpsilon");
  const [notes, setNotes] = useState("");
  useEffect(() => setNotes(problem?.meta.notes ?? ""), [problem?.id, problem?.meta.notes]);

  if (!problem) return <div className="p-4 text-xs text-muted-foreground">No problem open.</div>;
  const { meta } = problem;
  const interactorChoices = [
    ...new Set([
      meta.interactor ?? "interactor.cpp",
      ...problem.files.map((f) => f.name).filter((n) => n !== meta.mainFile && /\.(cpp|cc|cxx|py)$/.test(n)),
    ]),
  ];
  const update = (patch: ProblemMetaPatch) =>
    ctx.workspace.updateMeta(patch).catch((err) => ctx.notify.error("Could not update problem", String(err?.message ?? err)));
  const num = (v: string) => (v.trim() === "" ? undefined : Math.max(1, Math.round(Number(v)) || 0) || undefined);

  return (
    <div className="h-full space-y-3 overflow-y-auto p-3">
      <div className="grid gap-1.5">
        <Label>Name</Label>
        <CommitInput value={meta.name} onCommit={(name) => name.trim() && update({ name: name.trim() })} />
      </div>
      <div className="grid gap-1.5">
        <Label className="flex items-center gap-1.5">
          URL
          {meta.url && (
            <a href={meta.url} target="_blank" rel="noreferrer" className="text-primary">
              <ExternalLink className="size-3" />
            </a>
          )}
        </Label>
        <CommitInput placeholder="https://…" value={meta.url ?? ""} onCommit={(url) => update({ url: url.trim() || undefined })} />
      </div>
      <div className="space-y-2 rounded-md border p-2.5">
        <div>
          <Label>Mode</Label>
          <div className="mt-1.5">
            <ModeSegmented ctx={ctx} meta={meta} />
          </div>
        </div>
        {meta.runMode === "playground" && (
          <div className="text-[0.625rem] leading-relaxed text-muted-foreground">
            Run (top bar / Ctrl+Enter) executes the main file in the Terminal panel, where you type input live. The tests stay
            available via “Run all” in the Tests panel.
          </div>
        )}
        {meta.interactive && meta.runMode !== "playground" && (
          <div className="grid gap-1.5">
            <Label>Interactor</Label>
            <Select value={meta.interactor ?? "interactor.cpp"} onValueChange={(v) => update({ interactor: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {interactorChoices.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-[0.625rem] text-muted-foreground">
              Started as <span className="font-mono">interactor input.txt output.txt answer.txt</span>; exit code 0 = AC, 1 = WA. See the comments in the
              template.
            </div>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Status</Label>
          <Select value={meta.status} onValueChange={(v) => update({ status: v as ProblemStatus })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todo">To do</SelectItem>
              <SelectItem value="attempted">Attempted</SelectItem>
              <SelectItem value="solved">Solved</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Language</Label>
          <Select value={meta.language} onValueChange={(v) => update({ language: v as Language })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cpp">C++</SelectItem>
              <SelectItem value="python">Python</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Time limit (ms)</Label>
          <CommitInput type="number" placeholder={`${defaultTl} (default)`} value={meta.timeLimitMs?.toString() ?? ""} onCommit={(v) => update({ timeLimitMs: num(v) })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Memory limit (MB)</Label>
          <CommitInput type="number" placeholder="—" value={meta.memoryLimitMb?.toString() ?? ""} onCommit={(v) => update({ memoryLimitMb: num(v) })} />
        </div>
        <div className="grid gap-1.5">
          <Label>Output comparison</Label>
          <Select value={meta.compareMode ?? "__default"} onValueChange={(v) => update({ compareMode: v === "__default" ? undefined : (v as CompareMode) })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default">Default ({defaultCompare})</SelectItem>
              <SelectItem value="token">Tokens</SelectItem>
              <SelectItem value="float">Float tolerance</SelectItem>
              <SelectItem value="exact">Exact</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label className={cn((meta.compareMode ?? defaultCompare) !== "float" && "opacity-50")}>Float tolerance</Label>
          <CommitInput
            type="number"
            step="any"
            placeholder={`${defaultEps} (default)`}
            disabled={(meta.compareMode ?? defaultCompare) !== "float"}
            value={meta.floatEpsilon?.toString() ?? ""}
            onCommit={(v) => update({ floatEpsilon: v.trim() === "" || Number.isNaN(Number(v)) ? undefined : Math.max(0, Number(v)) })}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Tags</Label>
        <CommitInput
          placeholder="dp, greedy, graphs"
          value={meta.tags.join(", ")}
          onCommit={(v) => update({ tags: v.split(",").map((t) => t.trim()).filter(Boolean) })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Notes</Label>
        <Textarea
          className="min-h-28 font-sans"
          placeholder="Key idea, edge cases, complexity…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== (meta.notes ?? "") && update({ notes })}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 border-t pt-3">
        <Button variant="outline" size="sm" onClick={() => renameProblem(ctx, problem.id)}>
          <Pencil /> Rename
        </Button>
        <Button variant="outline" size="sm" onClick={() => moveProblem(ctx, problem.id)}>
          <FolderInput /> Move
        </Button>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => deleteProblem(ctx, problem.id)}>
          <Trash2 /> Delete
        </Button>
      </div>
      <div className="font-mono text-[0.625rem] break-all text-muted-foreground">{problem.id}</div>
    </div>
  );
}
