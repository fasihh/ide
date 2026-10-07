import { useEffect, useState } from "react";
import { Loader2, Play, Plus } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import { Badge, Button, Kbd, Textarea } from "@cp-ide/ui";
import { Transcript } from "./Transcript.tsx";

const key = (id: string) => `cp-ide.customInput.${id}`;

/** Scratch stdin per problem, kept in localStorage so it survives reloads. */
export function readCustomInput(problemId: string) {
  try {
    return localStorage.getItem(key(problemId)) ?? "";
  } catch {
    return "";
  }
}

export function CustomInputPanel({ ctx }: PanelProps) {
  const problemId = ctx.workspace.use((s) => s.problem?.id);
  const state = ctx.runner.use((s) => s.custom);
  const interactive = ctx.workspace.use((s) => !!s.problem?.meta.interactive);
  const [input, setInput] = useState("");

  useEffect(() => setInput(problemId ? readCustomInput(problemId) : ""), [problemId]);

  if (!problemId) return <div className="p-4 text-xs text-muted-foreground">Open a problem to run it on custom input.</div>;
  const result = state.status === "done" ? state.result : null;
  const busy = state.status === "running";

  return (
    <div className="flex h-full min-h-0">
      <div className="@container flex w-1/2 min-w-0 flex-col border-r">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b px-2">
          <span className="text-[0.6875rem] font-medium text-muted-foreground">{interactive ? "judge data" : "stdin"}</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            disabled={!input}
            title="Save as a test case"
            onClick={() => {
              ctx.workspace.addTest({ input, expected: result?.verdict === "RAN" ? result.stdout.replace(/\r\n/g, "\n") : "" });
              ctx.notify.success("Added as a test");
            }}
          >
            <Plus /> <span className="hidden @[16rem]:inline">Test</span>
          </Button>
          <Button size="sm" disabled={busy} onClick={() => ctx.runner.runCustom(input)}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />} Run
            <Kbd className="hidden border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground/80 @[22rem]:inline-flex">Ctrl+Shift+↵</Kbd>
          </Button>
        </div>
        <Textarea
          className="min-h-0 flex-1 resize-none rounded-none border-0 focus-visible:ring-0"
          placeholder="Input to feed the program…"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            try {
              localStorage.setItem(key(problemId), e.target.value);
            } catch {}
          }}
        />
      </div>
      <div className="flex w-1/2 min-w-0 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2 text-[0.6875rem] text-muted-foreground">
          <span className="font-medium">{interactive ? "conversation" : "stdout"}</span>
          {result && result.verdict !== "RAN" && <Badge variant={result.verdict}>{result.verdict}</Badge>}
          {result && result.verdict !== "CE" && <span className="font-mono">{result.timeMs} ms</span>}
          {result?.message && <span className="truncate text-verdict-re">{result.message}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {interactive && result && !busy ? (
            <Transcript result={result} className="m-1 max-h-none border-0" />
          ) : (
            <pre className="px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {busy ? <span className="text-muted-foreground">Running…</span> : (result?.stdout ?? <span className="text-muted-foreground">Output appears here.</span>)}
            </pre>
          )}
          {interactive && result?.interactorStderr && (
            <pre className="border-t px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-verdict-tle">{result.interactorStderr}</pre>
          )}
          {result?.stderr && (
            <pre className="border-t px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{result.stderr}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
