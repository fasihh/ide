import { Download, TriangleAlert } from "lucide-react";
import { create } from "zustand";
import { type PanelProps, type PluginRoutes, type WebPluginContext, definePlugin, unwrap } from "@cp-ide/plugin-api/web";
import { Tooltip, cn } from "@cp-ide/ui";
import type { CompanionMessage, ImportResult, ReceiverStatus } from "./messages.ts";
import type serverPlugin from "./server.ts";
import { companionSettings } from "./settings.ts";

const useStatus = create<{ status: ReceiverStatus }>(() => ({ status: { state: "stopped" } }));

function describe(status: ReceiverStatus): string {
  switch (status.state) {
    case "listening":
      return `Listening for Competitive Companion on port ${status.port}. Click the extension's button on a problem page to import it.`;
    case "error":
      return `Competitive Companion: ${status.error}. Change the port in Settings → Competitive Companion.`;
    default:
      return "Competitive Companion is not listening.";
  }
}

/** A quiet "ready" mark while listening; red when the port could not be opened. */
function CompanionStatus({ ctx }: PanelProps) {
  const status = useStatus((s) => s.status);
  if (status.state === "stopped") return null;
  const failed = status.state === "error";
  const Icon = failed ? TriangleAlert : Download;
  return (
    <Tooltip content={describe(status)}>
      <button
        className={cn("flex cursor-pointer items-center gap-1 hover:text-foreground", failed && "text-destructive")}
        onClick={() => ctx.commands.execute("settings.open")}
      >
        <Icon className="size-3" />
        Companion
      </button>
    </Tooltip>
  );
}

async function announce(ctx: WebPluginContext, openOnImport: boolean, imported: ImportResult[]) {
  // A contest's problems arrive in parallel; "first" should be problem A, not whichever came first.
  const problems = [...imported].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const first = problems[0];
  if (!first) return;
  await ctx.workspace.refreshProblems();
  const open = () => ctx.workspace.openProblem(first.id);
  if (openOnImport) await open();
  const tests = (r: ImportResult) => `${r.addedTests} test${r.addedTests === 1 ? "" : "s"}`;
  if (problems.length === 1) {
    const title = first.created ? `Imported ${first.name}` : `Updated ${first.name}`;
    ctx.notify.success(title, first.created ? `With ${tests(first)}.` : first.addedTests ? `Added ${tests(first)}.` : "Already up to date.", { label: "Open", run: open });
  } else {
    const created = problems.filter((p) => p.created).length;
    ctx.notify.success(`Imported ${problems.length} problems`, `${created} new, ${problems.length - created} already here.`, { label: "Open first", run: open });
  }
}

export default definePlugin({
  id: "competitive-companion",
  name: "Competitive Companion",
  description: "Import problems and sample tests from the Competitive Companion browser extension.",

  activate(ctx) {
    const settings = ctx.settings.contribute(companionSettings);
    const api = ctx.rpc<PluginRoutes<typeof serverPlugin>>();
    void unwrap(api.status.$get())
      .then((status) => useStatus.setState({ status }))
      .catch(() => {});

    ctx.serverEvents.on<CompanionMessage>((message) => {
      if (message.kind === "status") useStatus.setState({ status: message.status });
      else if (message.kind === "imported") void announce(ctx, settings.get("competitive-companion.openOnImport"), message.problems);
      else ctx.notify.error("Competitive Companion import failed", message.message);
    });

    ctx.statusBar.register({ id: "competitive-companion.status", align: "right", order: -20, component: CompanionStatus });
    return { dispose: () => useStatus.setState({ status: { state: "stopped" } }) };
  },
});
