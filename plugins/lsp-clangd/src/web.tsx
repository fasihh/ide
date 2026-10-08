import { type PluginRoutes, definePlugin, unwrap } from "@cp-ide/plugin-api/web";
import type serverPlugin from "./server.ts";
import { DOWNLOAD_ACTION } from "./resolve.ts";
import { clangdSettings } from "./settings.ts";

/** The server half registers clangd with core; the web half shows the settings and offers the download. */
export default definePlugin({
  id: "lsp-clangd",
  name: "C++ language server (clangd)",
  description: "Completions, hover, signature help, diagnostics as you type and go to definition for C++.",

  activate(ctx) {
    ctx.settings.contribute(clangdSettings);
    const api = ctx.rpc<PluginRoutes<typeof serverPlugin>>();

    ctx.commands.register({
      id: DOWNLOAD_ACTION.command,
      title: "Download clangd (C++ language server)",
      category: "Editor",
      async run() {
        let release;
        try {
          release = await unwrap(api.release.$get());
        } catch (err) {
          return ctx.notify.error("Could not look up the latest clangd", String((err as Error)?.message ?? err));
        }
        const ok = await ctx.ui.confirm({
          title: `Download clangd ${release.version}?`,
          message: `${release.asset} (${Math.round(release.sizeBytes / 1e6)} MB) from github.com/clangd/clangd, unpacked into the IDE's data folder. Nothing is installed system-wide.`,
          confirmLabel: "Download",
        });
        if (!ok) return;
        ctx.notify.info(`Downloading clangd ${release.version}…`, "C++ language support starts when it finishes.");
        try {
          await unwrap(api.install.$post());
        } catch (err) {
          return ctx.notify.error("clangd download failed", String((err as Error)?.message ?? err));
        }
        ctx.notify.success(`clangd ${release.version} is ready`);
        ctx.languageServers.restart("clangd");
      },
    });
  },
});
