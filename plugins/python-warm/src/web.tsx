import { definePlugin } from "@cp-ide/plugin-api/web";
import { warmSettings } from "./settings.ts";

/** The server half does the work; the web half only shows the setting. */
export default definePlugin({
  id: "python-warm",
  name: "Python warm start",
  description: "Pre-loads your last script's imports so the next Python terminal run starts without the import wait.",

  activate(ctx) {
    ctx.settings.contribute(warmSettings);
  },
});
