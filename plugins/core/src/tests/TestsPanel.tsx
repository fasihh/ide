import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff, Loader2, Play, Plus, Trash2 } from "lucide-react";
import type { PanelProps, TestRunState, WebPluginContext } from "@cp-ide/plugin-api/web";
import type { ExecResult, TestCase } from "@cp-ide/shared";
import { Badge, Button, Kbd, Textarea, Tooltip, cn } from "@cp-ide/ui";

const VERDICT_LABEL: Record<ExecResult["verdict"], string> = {
  AC: "Accepted",
  WA: "Wrong answer",
  TLE: "Time limit",
  RE: "Runtime error",
  OLE: "Output limit",
  CE: "Compile error",
  RAN: "Ran",
};

function StatusBadge({ state }: { state: TestRunState | undefined }) {
  if (!state || state.status === "idle") return null;
  if (state.status === "queued") return <Badge variant="outline">queued</Badge>;
  if (state.status === "running")
    return (
      <Badge variant="outline">
        <Loader2 className="size-3 animate-spin" /> running
      </Badge>
    );
  const v = state.result.verdict;
  return (
    <Tooltip content={state.result.message ?? VERDICT_LABEL[v]}>
      <Badge variant={v}>{v}</Badge>
    </Tooltip>
  );
}

function FieldLabel({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex h-5 items-center justify-between">
      <span className="text-[11px] font-medium text-muted-foreground">{children}</span>
      {actions}
    </div>
  );
}

const areaClass = "field-sizing-content max-h-72 min-h-10 resize-none bg-background/40 leading-relaxed";

function OutputView({ result, expected }: { result: ExecResult; expected: string }) {
  const lines = result.stdout.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const bad = result.verdict === "WA" ? result.diff?.actualLine : null;
  return (
    <div className="max-h-72 overflow-auto rounded-md border bg-background/40 py-1.5 font-mono text-xs leading-relaxed">
      {result.stdout === "" ? (
        <div className="px-2 text-muted-foreground italic">(no output)</div>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={cn("px-2 whitespace-pre", bad === i + 1 && "bg-verdict-wa/15")}>
            {l || " "}
          </div>
        ))
      )}
      {result.verdict === "WA" && result.diff && (
        <div className="mt-1 border-t px-2 pt-1 text-[11px] text-verdict-wa">
          {result.diff.actualToken === null
            ? `Output ended early; expected "${result.diff.expectedToken}" (line ${result.diff.expectedLine})`
            : result.diff.expectedToken === null
              ? `Extra output "${result.diff.actualToken}" on line ${result.diff.actualLine}`
              : `Line ${result.diff.actualLine}: expected "${result.diff.expectedToken}", got "${result.diff.actualToken}"`}
        </div>
      )}
      {expected === "" && result.verdict === "RAN" && (
        <div className="mt-1 border-t px-2 pt-1 text-[11px] text-muted-foreground">No expected output to compare against.</div>
      )}
    </div>
  );
}

function TestCard({ ctx, test, index, state }: { ctx: WebPluginContext; test: TestCase; index: number; state: TestRunState | undefined }) {
  const [open, setOpen] = useState(true);
  const result = state?.status === "done" ? state.result : null;
  const busy = state?.status === "running" || state?.status === "queued";

  return (
    <div className={cn("rounded-md border", !test.enabled && "opacity-55")}>
      <div className="group flex h-8 items-center gap-1.5 pr-1 pl-1.5">
        <button className="flex flex-1 cursor-pointer items-center gap-1.5 text-left" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          <span className="text-xs font-medium">Test {index + 1}</span>
          {test.isSample && <span className="text-[10px] text-muted-foreground">sample</span>}
          <StatusBadge state={state} />
          {result && result.verdict !== "CE" && <span className="font-mono text-[10px] text-muted-foreground">{result.timeMs} ms</span>}
        </button>
        <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100">
          <Tooltip content="Run this test">
            <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => ctx.runner.run([test.id])}>
              <Play />
            </Button>
          </Tooltip>
          <Tooltip content={test.enabled ? "Exclude from Run all" : "Include in Run all"}>
            <Button variant="ghost" size="icon-sm" onClick={() => ctx.workspace.updateTest(test.id, { enabled: !test.enabled })}>
              {test.enabled ? <Eye /> : <EyeOff />}
            </Button>
          </Tooltip>
          <Tooltip content="Delete test">
            <Button variant="ghost" size="icon-sm" onClick={() => ctx.workspace.removeTest(test.id)}>
              <Trash2 />
            </Button>
          </Tooltip>
        </div>
      </div>
      {open && (
        <div className="space-y-2 border-t px-2 pt-1.5 pb-2">
          <div>
            <FieldLabel>Input</FieldLabel>
            <Textarea className={areaClass} value={test.input} onChange={(e) => ctx.workspace.updateTest(test.id, { input: e.target.value })} />
          </div>
          <div>
            <FieldLabel>Expected output</FieldLabel>
            <Textarea
              className={areaClass}
              placeholder="Leave empty to just see the output"
              value={test.expected}
              onChange={(e) => ctx.workspace.updateTest(test.id, { expected: e.target.value })}
            />
          </div>
          {result && result.verdict !== "CE" && (
            <div>
              <FieldLabel
                actions={
                  result.stdout && (
                    <button
                      className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => ctx.workspace.updateTest(test.id, { expected: result.stdout.replace(/\r\n/g, "\n") })}
                    >
                      <Copy className="size-3" /> use as expected
                    </button>
                  )
                }
              >
                Output
              </FieldLabel>
              <OutputView result={result} expected={test.expected} />
            </div>
          )}
          {result?.message && result.verdict !== "WA" && <div className="text-[11px] text-verdict-re">{result.message}</div>}
          {result?.stderr && (
            <div>
              <FieldLabel>stderr</FieldLabel>
              <pre className="max-h-48 overflow-auto rounded-md border bg-background/40 px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {result.stderr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TestsPanel({ ctx }: PanelProps) {
  const problem = ctx.workspace.use((s) => s.problem);
  const states = ctx.runner.use((s) => s.tests);
  const phase = ctx.runner.use((s) => s.phase);

  if (!problem) return <div className="p-4 text-xs text-muted-foreground">Open a problem to manage its tests.</div>;

  const ran = problem.tests.filter((t) => states[t.id]?.status === "done");
  const passed = ran.filter((t) => {
    const s = states[t.id];
    return s?.status === "done" && (s.result.verdict === "AC" || s.result.verdict === "RAN");
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="text-xs text-muted-foreground">
          {problem.tests.length} test{problem.tests.length === 1 ? "" : "s"}
          {ran.length > 0 && (
            <span className={cn("ml-2 font-medium", passed.length === ran.length ? "text-verdict-ac" : "text-verdict-wa")}>
              {passed.length}/{ran.length} passed
            </span>
          )}
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => ctx.workspace.addTest()}>
          <Plus /> Add
        </Button>
        <Button size="sm" disabled={phase !== "idle" || problem.tests.length === 0} onClick={() => ctx.runner.run()}>
          {phase === "idle" ? <Play /> : <Loader2 className="animate-spin" />}
          Run all <Kbd className="border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80">Ctrl+↵</Kbd>
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {problem.tests.map((t, i) => (
          <TestCard key={t.id} ctx={ctx} test={t} index={i} state={states[t.id]} />
        ))}
        {problem.tests.length === 0 && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No tests yet.{" "}
            <button className="cursor-pointer text-primary hover:underline" onClick={() => ctx.workspace.addTest()}>
              Add one
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
