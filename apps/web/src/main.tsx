import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./shell/App.tsx";
import { installKeybindings } from "./core/keybindings.ts";
import { activatePlugins } from "./core/plugin-host.ts";
import { loadSettings, useSettings } from "./core/settings.ts";
import { installTheme } from "./core/theme.ts";
import { installServerEvents } from "./core/server-events.ts";
import { restoreLastProblem, workspace } from "./core/workspace.ts";
import { reportError } from "./core/notify.ts";

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  try {
    await loadSettings();
  } catch (err) {
    root.render(
      <div className="p-6 font-mono text-sm">
        Could not reach the cp-ide server. Is it running? ({err instanceof Error ? err.message : String(err)})
      </div>,
    );
    return;
  }
  installTheme();
  installKeybindings();
  if (import.meta.env.DEV) {
    // Debug handle: inspect stores from the devtools console.
    const [{ useWorkspace, workspaceApi }, { useRunner, runnerApi }, { useRegistry }, { useLayout, layout }] = await Promise.all([
      import("./core/workspace.ts"),
      import("./core/runner.ts"),
      import("./core/registry.ts"),
      import("./core/layout.ts"),
    ]);
    Object.assign(window, {
      __cp: { useWorkspace, useRunner, useRegistry, useLayout, useSettings, workspace: workspaceApi, runner: runnerApi, layout },
    });
  }
  // Plugins register panels before the dock is created, so the layout can reference them.
  await activatePlugins();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await workspace.refreshProblems().catch(reportError("Could not list problems"));
  installServerEvents();
  await restoreLastProblem();
}

void boot();
