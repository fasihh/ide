import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import type { Language, ProblemMetaPatch, ProblemStatus } from "@cp-ide/shared";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@cp-ide/ui";

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
  const [notes, setNotes] = useState("");
  useEffect(() => setNotes(problem?.meta.notes ?? ""), [problem?.id, problem?.meta.notes]);

  if (!problem) return <div className="p-4 text-xs text-muted-foreground">No problem open.</div>;
  const { meta } = problem;
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
      <div className="font-mono text-[0.625rem] break-all text-muted-foreground">{problem.id}</div>
    </div>
  );
}
