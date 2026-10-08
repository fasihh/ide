import { definePlugin } from "@cp-ide/plugin-api/web";
import { clangdSettings } from "./settings.ts";

/** The server half registers clangd with core; the web half only shows the setting. */
export default definePlugin({
  id: "lsp-clangd",
  name: "C++ language server (clangd)",
  description: "Completions, hover, signature help, diagnostics as you type and go to definition for C++.",

  activate(ctx) {
    ctx.settings.contribute(clangdSettings);
  },
});
