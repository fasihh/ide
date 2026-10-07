import { create } from "zustand";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  FileInput,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import type { PanelProps, TestRunState, WebPluginContext } from "@cp-ide/plugin-api/web";
import type { ExecResult, TestCase } from "@cp-ide/shared";
import { Transcript } from "./Transcript.tsx";
import { ModeChip } from "../problem/ModeControl.tsx";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Textarea,
  Tooltip,
  cn,
} from "@cp-ide/ui";

/** Collapsed test cards, shared so "collapse all" can drive every card. */
const useCollapsed = create<{ ids: Set<string> }>(() => ({ ids: new Set() }));
const toggleCollapsed = (id: string) =>
  useCollapsed.setState((s) => {
    const ids = new Set(s.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ids };
  });

/** Pair `name.in` with `name.out` / `name.ans` files in the problem folder and add them as tests. */
export function importTestFiles(ctx: WebPluginContext) {
  const { buffers, problem } = ctx.workspace.get();
  if (!problem) return;
  const existing = new Set(problem.tests.map((t) => t.input.trim()));
  let added = 0;
  for (const name of Object.keys(buffers).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const m = /^(.*)\.in$/i.exec(name);
    if (!m) continue;
    const input = buffers[name]!.content;
    if (existing.has(input.trim())) continue;
    const out = buffers[`${m[1]}.out`] ?? buffers[`${m[1]}.ans`];
    ctx.workspace.addTest({ input, expected: out?.content ?? "" });
    existing.add(input.trim());
    added++;
  }
  if (added) ctx.notify.success(`Imported ${added} test${added === 1 ? "" : "s"}`);
  else ctx.notify.info("No new .in files to import", "Add files like 1.in / 1.out to the problem (+ in the editor tabs).");
}

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
      <span className="text-[0.6875rem] font-medium text-muted-foreground">{children}</span>
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
        <div className="mt-1 border-t px-2 pt-1 text-[0.6875rem] text-verdict-wa">
          {result.diff.actualToken === null
            ? `Output ended early; expected "${result.diff.expectedToken}" (line ${result.diff.expectedLine})`
            : result.diff.expectedToken === null
              ? `Extra output "${result.diff.actualToken}" on line ${result.diff.actualLine}`
              : `Line ${result.diff.actualLine}: expected "${result.diff.expectedToken}", got "${result.diff.actualToken}"`}
        </div>
      )}
      {expected === "" && result.verdict === "RAN" && (
        <div className="mt-1 border-t px-2 pt-1 text-[0.6875rem] text-muted-foreground">No expected output to compare against.</div>
      )}
    </div>
  );
}

function TestCard({ ctx, test, index, state }: { ctx: WebPluginContext; test: TestCase; index: number; state: TestRunState | undefined }) {
  const open = !useCollapsed((s) => s.ids.has(test.id));
  const count = ctx.workspace.use((s) => s.problem?.tests.length ?? 0);
  const interactive = ctx.workspace.use((s) => !!s.problem?.meta.interactive);
  const result = state?.status === "done" ? state.result : null;
  const busy = state?.status === "running" || state?.status === "queued";

  return (
    <div className={cn("rounded-md border", !test.enabled && "opacity-55")}>
      <div className="group flex h-8 items-center gap-1.5 pr-1 pl-1.5">
        <button className="flex flex-1 cursor-pointer items-center gap-1.5 text-left" onClick={() => toggleCollapsed(test.id)}>
          {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          <span className="text-xs font-medium">Test {index + 1}</span>
          {test.isSample && <span className="text-[0.625rem] text-muted-foreground">sample</span>}
          <StatusBadge state={state} />
          {result && result.verdict !== "CE" && <span className="font-mono text-[0.625rem] text-muted-foreground">{result.timeMs} ms</span>}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => ctx.workspace.duplicateTest(test.id)}>
                <CopyPlus /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => ctx.workspace.moveTest(test.id, -1)}>
                <ArrowUp /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => ctx.workspace.moveTest(test.id, 1)}>
                <ArrowDown /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => ctx.workspace.removeTest(test.id)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {open && (
        <div className="space-y-2 border-t px-2 pt-1.5 pb-2">
          <div>
            <FieldLabel>{interactive ? "Judge data (given to the interactor as its input file)" : "Input"}</FieldLabel>
            <Textarea
              className={areaClass}
              placeholder={interactive ? "e.g. 1000 777 — hidden values only the interactor reads" : undefined}
              value={test.input}
              onChange={(e) => ctx.workspace.updateTest(test.id, { input: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel>{interactive ? "Answer file (optional, for the interactor)" : "Expected output"}</FieldLabel>
            <Textarea
              className={areaClass}
              placeholder={interactive ? "Passed to the interactor as its answer file" : "Leave empty to just see the output"}
              value={test.expected}
              onChange={(e) => ctx.workspace.updateTest(test.id, { expected: e.target.value })}
            />
          </div>
          {result && result.verdict !== "CE" && interactive && (
            <div>
              <FieldLabel>Conversation</FieldLabel>
              <Transcript result={result} />
            </div>
          )}
          {result && result.verdict !== "CE" && !interactive && (
            <div>
              <FieldLabel
                actions={
                  result.stdout && (
                    <button
                      className="flex cursor-pointer items-center gap-1 text-[0.625rem] text-muted-foreground hover:text-foreground"
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
          {result?.message && (interactive || result.verdict !== "WA") && (
            <div className={cn("text-[0.6875rem]", result.verdict === "AC" ? "text-verdict-ac" : "text-verdict-re")}>
              {interactive && result.verdict !== "AC" ? "Judge: " : ""}
              {result.message}
            </div>
          )}
          {interactive && result?.interactorStderr && result.interactorStderr.trim().includes("\n") && (
            <div>
              <FieldLabel>Interactor stderr</FieldLabel>
              <pre className="max-h-32 overflow-auto rounded-md border bg-background/40 px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {result.interactorStderr}
              </pre>
            </div>
          )}
          {result?.stderr && (
            <div>
              <FieldLabel>{interactive ? "Your stderr" : "stderr"}</FieldLabel>
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
  const anyOpen = useCollapsed((s) => !!problem && problem.tests.some((t) => !s.ids.has(t.id)));

  if (!problem) return <div className="p-4 text-xs text-muted-foreground">Open a problem to manage its tests.</div>;

  const ran = problem.tests.filter((t) => states[t.id]?.status === "done");
  const passed = ran.filter((t) => {
    const s = states[t.id];
    return s?.status === "done" && (s.result.verdict === "AC" || s.result.verdict === "RAN");
  });

  return (
    <div className="@container flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <span className="truncate text-xs whitespace-nowrap text-muted-foreground">
          {problem.tests.length} test{problem.tests.length === 1 ? "" : "s"}
          {ran.length > 0 && (
            <span className={cn("ml-2 font-medium", passed.length === ran.length ? "text-verdict-ac" : "text-verdict-wa")}>
              {passed.length}/{ran.length} passed
            </span>
          )}
        </span>
        <ModeChip ctx={ctx} meta={problem.meta} />
        <div className="flex-1" />
        <Tooltip content={anyOpen ? "Collapse all" : "Expand all"}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => useCollapsed.setState({ ids: anyOpen ? new Set(problem.tests.map((t) => t.id)) : new Set() })}
          >
            {anyOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
          </Button>
        </Tooltip>
        <Tooltip content="Import .in / .out files from the problem folder">
          <Button variant="ghost" size="icon-sm" onClick={() => importTestFiles(ctx)}>
            <FileInput />
          </Button>
        </Tooltip>
        <Button variant="ghost" size="sm" onClick={() => ctx.workspace.addTest()}>
          <Plus /> <span className="hidden @[20rem]:inline">Add</span>
        </Button>
        <Button size="sm" disabled={phase !== "idle" || problem.tests.length === 0} onClick={() => ctx.runner.run()}>
          {phase === "idle" ? <Play /> : <Loader2 className="animate-spin" />}
          Run all <Kbd className="hidden border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80 @[26rem]:inline-flex">Ctrl+↵</Kbd>
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
