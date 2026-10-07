import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import { linkify } from "../editor/diagnostics.ts";

export function OutputPanel({ ctx }: PanelProps) {
  const compile = ctx.runner.use((s) => s.compile);
  const phase = ctx.runner.use((s) => s.phase);
  const problem = ctx.workspace.use((s) => s.problem);
  const fileName = problem?.meta.mainFile ?? "main";

  let status: React.ReactNode = <span className="text-muted-foreground">Not compiled yet — press Ctrl+Enter to run.</span>;
  if (phase === "compiling") {
    status = (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Compiling…
      </span>
    );
  } else if (compile) {
    status = compile.ok ? (
      <span className="flex items-center gap-1.5 text-verdict-ac">
        <CheckCircle2 className="size-3.5" />
        {compile.cached ? "Up to date (cached build)" : `Compiled in ${compile.timeMs} ms`}
      </span>
    ) : (
      <span className="flex items-center gap-1.5 text-verdict-wa">
        <XCircle className="size-3.5" /> Compilation failed
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b px-3 text-xs">{status}</div>
      <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {compile?.stderr
          ? linkify(compile.stderr, fileName).map((seg, i) =>
              "line" in seg ? (
                <button
                  key={i}
                  className="cursor-pointer text-primary underline-offset-2 hover:underline"
                  onClick={() => ctx.commands.execute("editor.revealLine", seg.line, seg.column)}
                >
                  {seg.text}
                </button>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )
          : compile?.ok && <span className="text-muted-foreground">No warnings.</span>}
      </pre>
    </div>
  );
}
