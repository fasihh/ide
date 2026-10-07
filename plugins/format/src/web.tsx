import { type PluginRoutes, definePlugin, unwrap } from "@cp-ide/plugin-api/web";
import type serverPlugin from "./server.ts";
import { formatSettings } from "./settings.ts";

const LANGUAGE_BY_EXT: Record<string, "cpp" | "python"> = { cpp: "cpp", cc: "cpp", cxx: "cpp", h: "cpp", hpp: "cpp", py: "python" };

export default definePlugin({
  id: "format",
  name: "Formatter",
  description: "Format the current file with clang-format (C++) or black (Python).",

  activate(ctx) {
    const api = ctx.rpc<PluginRoutes<typeof serverPlugin>>();
    const config = ctx.settings.contribute(formatSettings);

    async function formatActive(quiet = false) {
      const { activeFile, buffers } = ctx.workspace.get();
      const language = activeFile ? LANGUAGE_BY_EXT[activeFile.split(".").pop()?.toLowerCase() ?? ""] : undefined;
      if (!activeFile || !language) {
        if (!quiet) ctx.notify.info("Nothing to format", "Open a .cpp or .py file.");
        return;
      }
      const source = buffers[activeFile]?.content ?? "";
      let res;
      try {
        res = await unwrap(api.index.$post({ json: { language, source } }));
      } catch (err) {
        return ctx.notify.error("Format failed", String(err));
      }
      if (!res.ok) return ctx.notify.error("Format failed", res.error);
      if (res.source !== source) ctx.workspace.setBuffer(activeFile, res.source);
    }

    ctx.commands.register({ id: "format.document", title: "Format document", category: "Editor", keybinding: "shift+alt+f", run: () => formatActive() });

    // Format on save: wrap the core save command (same id, so Ctrl+S and the palette use it).
    const save = ctx.commands.list().find((c) => c.id === "workspace.save");
    if (save) {
      ctx.commands.register({
        id: save.id,
        title: save.title,
        category: save.category,
        keybinding: save.defaultKeybinding,
        run: async () => {
          if (config.get("format.onSave")) await formatActive(true);
          await ctx.workspace.saveAll();
        },
      });
    }
  },
});
