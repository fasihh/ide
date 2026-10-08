import { ArrowLeftRight, Check, ChevronDown, ListChecks, SquareTerminal } from "lucide-react";
import type { WebPluginContext } from "@cp-ide/plugin-api/web";
import type { ProblemMeta, ProblemMetaPatch } from "@cp-ide/shared";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, Tooltip, cn } from "@cp-ide/ui";

export type ProblemMode = "standard" | "interactive" | "playground";

export const MODES: { id: ProblemMode; label: string; description: string; icon: typeof ListChecks; tone: string }[] = [
  { id: "standard", label: "Standard", description: "Run compares output with each test", icon: ListChecks, tone: "text-muted-foreground" },
  { id: "interactive", label: "Interactive", description: "Tests talk to an interactor (your judge program)", icon: ArrowLeftRight, tone: "text-verdict-tle" },
  {
    id: "playground",
    label: "Playground",
    description: "Run executes the main file in the Terminal with live input",
    icon: SquareTerminal,
    tone: "text-verdict-ran",
  },
];

export const modeOf = (meta: ProblemMeta): ProblemMode => (meta.runMode === "playground" ? "playground" : meta.interactive ? "interactive" : "standard");

/** Explicit values (not undefined) so the server-side merge actually clears the other mode. */
const PATCH: Record<ProblemMode, ProblemMetaPatch> = {
  standard: { interactive: false, runMode: "tests" },
  interactive: { interactive: true, runMode: "tests" },
  playground: { runMode: "playground" },
};

const playgroundAvailable = (ctx: WebPluginContext) => ctx.plugins.list().some((p) => p.id === "playground" && p.enabled);

export function setMode(ctx: WebPluginContext, mode: ProblemMode) {
  if (mode === "playground" && !playgroundAvailable(ctx)) return ctx.notify.error("The Playground plugin is disabled", "Enable it in Settings → Plugins.");
  return ctx.workspace.updateMeta(PATCH[mode]).catch((e) => ctx.notify.error("Could not change mode", String(e?.message ?? e)));
}

/** Compact dropdown for panel headers. */
export function ModeChip({ ctx, meta }: { ctx: WebPluginContext; meta: ProblemMeta }) {
  const mode = MODES.find((m) => m.id === modeOf(meta))!;
  const Icon = mode.icon;
  return (
    <DropdownMenu>
      <Tooltip content={`Mode: ${mode.label} — ${mode.description}`}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 text-[0.625rem] whitespace-nowrap hover:bg-accent",
              mode.id === "standard" ? "text-muted-foreground hover:text-foreground" : `bg-accent/60 ${mode.tone}`,
            )}
          >
            <Icon className="size-3" />
            <span className="hidden @[24rem]:inline">{mode.label}</span>
            <ChevronDown className="size-2.5 opacity-60" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Problem mode</DropdownMenuLabel>
        {MODES.map((m) => (
          <DropdownMenuItem key={m.id} disabled={m.id === "playground" && !playgroundAvailable(ctx)} onSelect={() => setMode(ctx, m.id)}>
            <Check className={cn(m.id === mode.id ? "opacity-100" : "opacity-0")} />
            <m.icon className={m.tone} />
            <div>
              <div>{m.label}</div>
              <div className="text-[0.625rem] text-muted-foreground">{m.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Segmented control for the Problem panel. */
export function ModeSegmented({ ctx, meta }: { ctx: WebPluginContext; meta: ProblemMeta }) {
  return <ModePicker ctx={ctx} value={modeOf(meta)} onChange={(mode) => setMode(ctx, mode)} />;
}

/** The three modes as a segmented control (controlled). */
export function ModePicker({ ctx, value, onChange }: { ctx: WebPluginContext; value: ProblemMode; onChange: (mode: ProblemMode) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5">
      {MODES.map((m) => (
        <Tooltip key={m.id} content={m.description}>
          <button
            type="button"
            disabled={m.id === "playground" && !playgroundAvailable(ctx)}
            onClick={() => onChange(m.id)}
            className={cn(
              "flex h-6 cursor-pointer items-center justify-center gap-1 rounded text-[0.6875rem] disabled:cursor-not-allowed disabled:opacity-40",
              value === m.id ? `bg-background font-medium shadow-sm ${m.tone}` : "text-muted-foreground hover:text-foreground",
            )}
          >
            <m.icon className="size-3" />
            {m.label}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
