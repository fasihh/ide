import type { ExecResult } from "@cp-ide/shared";
import { cn } from "@cp-ide/ui";

/** The conversation of an interactive run: judge lines on the left, solution lines on the right. */
export function Transcript({ result, className }: { result: ExecResult; className?: string }) {
  const entries = result.transcript ?? [];
  return (
    <div className={cn("max-h-72 overflow-auto rounded-md border bg-background/40 py-1 font-mono text-xs leading-relaxed", className)}>
      {entries.length === 0 && <div className="px-2 text-muted-foreground italic">(nothing was exchanged)</div>}
      {entries.map((e, i) => {
        const lines = e.text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
        const judge = e.from === "interactor";
        return (
          <div key={i} className={cn("flex gap-2 px-2", judge ? "" : "bg-primary/5")}>
            <span className={cn("w-12 shrink-0 text-right text-[0.625rem] leading-5 select-none", judge ? "text-verdict-tle" : "text-primary")}>
              {judge ? "judge →" : "← you"}
            </span>
            <span className="min-w-0 whitespace-pre-wrap">{lines.join("\n")}</span>
          </div>
        );
      })}
      {result.transcriptTruncated && <div className="px-2 text-[0.625rem] text-muted-foreground">… transcript truncated</div>}
    </div>
  );
}
