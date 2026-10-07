import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, Wrench, XCircle } from "lucide-react";
import { type PluginRoutes, type RpcClient, definePlugin, unwrap } from "@cp-ide/plugin-api/web";
import { defineSettings } from "@cp-ide/shared";
import { Button } from "@cp-ide/ui";
import type serverPlugin from "./server.ts";

type Api = RpcClient<PluginRoutes<typeof serverPlugin>>;
type Info = Awaited<ReturnType<typeof fetchInfo>>;

const settings = defineSettings({
  "toolchain.checkOnStartup": {
    section: "Toolchain",
    label: "Check toolchain on startup",
    description: "Warn when the configured compiler or interpreter cannot be started.",
    type: "boolean",
    default: true,
  },
});

function fetchInfo(api: Api) {
  return unwrap(api.info.$get());
}

export default definePlugin({
  id: "toolchain",
  name: "Toolchain",
  description: "Shows compiler / interpreter versions and warns when they are missing.",

  activate(ctx) {
    const api = ctx.rpc<PluginRoutes<typeof serverPlugin>>();
    const config = ctx.settings.contribute(settings);

    function ToolchainPanel() {
      const [info, setInfo] = useState<Info | null>(null);
      const [loading, setLoading] = useState(false);
      const load = useCallback(() => {
        setLoading(true);
        fetchInfo(api)
          .then(setInfo)
          .catch((e) => ctx.notify.error("Toolchain check failed", String(e)))
          .finally(() => setLoading(false));
      }, []);
      useEffect(load, [load]);

      return (
        <div className="h-full space-y-3 overflow-y-auto p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">Toolchain</span>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} /> Re-check
            </Button>
          </div>
          {info?.tools.map((t) => (
            <div key={t.name} className="rounded-md border p-2.5">
              <div className="flex items-center gap-1.5 font-medium">
                {t.ok ? <CheckCircle2 className="size-3.5 text-verdict-ac" /> : <XCircle className="size-3.5 text-verdict-wa" />}
                {t.name} <span className="font-mono font-normal text-muted-foreground">{t.command}</span>
              </div>
              <div className="mt-1 font-mono break-all text-muted-foreground">{t.version}</div>
            </div>
          ))}
          {info && (
            <div className="space-y-0.5 font-mono text-[0.6875rem] text-muted-foreground">
              <div>platform: {info.platform}</div>
              <div>node: {info.node}</div>
              <div>problems: {info.problemsRoot}</div>
            </div>
          )}
        </div>
      );
    }

    ctx.panels.register({ id: "toolchain.panel", title: "Toolchain", icon: Wrench, component: ToolchainPanel, placement: "right", order: 50 });
    ctx.commands.register({ id: "toolchain.open", title: "Show toolchain info", category: "Toolchain", run: () => ctx.panels.open("toolchain.panel") });

    if (config.get("toolchain.checkOnStartup")) {
      fetchInfo(api)
        .then((info) => {
          for (const t of info.tools.filter((x) => !x.ok)) {
            ctx.notify.error(`${t.name} not found`, `"${t.command}" could not be started. Fix it in Settings.`);
          }
        })
        .catch(() => {});
    }
  },
});
