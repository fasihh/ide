import { fileURLToPath } from "node:url";
import { DisposableStore, defineServerPlugin } from "@cp-ide/plugin-api/server";
import { WarmPythonLauncher } from "./launcher.ts";
import { warmSettings } from "./settings.ts";

const BOOTSTRAP = fileURLToPath(new URL("./warm_bootstrap.py", import.meta.url));
const IDLE_MS = 15 * 60_000;

const plugin = defineServerPlugin({
  id: "python-warm",
  name: "Python warm start",
  description: "Pre-loads your last script's imports so the next Python terminal run starts without the import wait.",
  settings: warmSettings,
  setup(ctx) {
    const launcher = new WarmPythonLauncher({
      bootstrap: BOOTSTRAP,
      enabled: () => ctx.settings.getRaw("python-warm.enabled") === true,
      idleMs: IDLE_MS,
    });
    const disposables = new DisposableStore();
    disposables.add(launcher);
    disposables.add(ctx.runner.registerLauncher(launcher));
    disposables.add(
      ctx.on("settings:changed", ({ changed }) => {
        // A standby started for the old configuration would never be used; free its memory now.
        if ("python-warm.enabled" in changed || "python.interpreter" in changed) launcher.clear();
      }),
    );
    return disposables;
  },
});

export default plugin;
