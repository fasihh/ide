import { AlertTriangle, CircleCheck, CircleX, Loader2 } from "lucide-react";
import type { LanguageServerState, PanelProps } from "@cp-ide/plugin-api/web";
import { Tooltip, cn } from "@cp-ide/ui";

const ICON = { starting: Loader2, ready: CircleCheck, error: CircleX, unavailable: AlertTriangle } as const;

function describe(name: string, state: LanguageServerState): string {
  switch (state.phase) {
    case "starting":
      return `${name} is starting…`;
    case "ready":
      return `${name} is running — click to restart`;
    case "error":
      return `${name} failed: ${state.error} — click to retry`;
    case "unavailable":
      return `${name} is not available: ${state.error}${state.hint ? `\n${state.hint}` : ""}\n${state.action ? `Click: ${state.action.label}` : "Click to check again."}`;
    default:
      return name;
  }
}

/**
 * One item per language server that is running, failing, or missing for the open problem's language.
 * Idle servers (no editor needed them yet) stay hidden.
 */
export function LanguageServerStatus({ ctx }: PanelProps) {
  const states = ctx.languageServers.useStates();
  const language = ctx.workspace.use((s) => s.problem?.meta.language);
  const servers = ctx.languageServers.list().filter((info) => {
    const phase = states[info.id]?.phase;
    return phase === "starting" || phase === "ready" || phase === "error" || (phase === "unavailable" && !!language && info.languages.includes(language));
  });
  return (
    <>
      {servers.map((info) => {
        const state = states[info.id]!;
        const Icon = ICON[state.phase as keyof typeof ICON];
        return (
          <Tooltip key={info.id} content={<span className="whitespace-pre-line">{describe(info.name, state)}</span>}>
            <button
              className={cn(
                "flex cursor-pointer items-center gap-1 hover:text-foreground",
                state.phase === "error" && "text-destructive",
                state.phase === "unavailable" && "text-amber-500",
              )}
              onClick={() => (state.phase === "unavailable" && state.action ? ctx.commands.execute(state.action.command) : ctx.languageServers.restart(info.id))}
            >
              <Icon className={cn("size-3", state.phase === "starting" && "animate-spin")} />
              {info.name}
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}
