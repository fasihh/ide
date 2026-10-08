import { definePlugin } from "@cp-ide/plugin-api/web";
import { basedpyrightSettings } from "./settings.ts";

/** The server half registers basedpyright with core; the web half only shows the setting. */
export default definePlugin({
  id: "lsp-basedpyright",
  name: "Python language server (basedpyright)",
  description: "Completions, hover, signature help, type diagnostics and go to definition for Python. Bundled — nothing to install.",

  activate(ctx) {
    ctx.settings.contribute(basedpyrightSettings);
  },
});
