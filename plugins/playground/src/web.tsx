import { FlaskConical, SquareTerminal } from "lucide-react";
import { definePlugin } from "@cp-ide/plugin-api/web";
import { PlaygroundPanel, downloadPlaygroundFile, newPlaygroundFile, runPlayground, saveAsProblem } from "./PlaygroundPanel.tsx";
import { TerminalPanel, focusTerminal } from "./TerminalPanel.tsx";
import { initStore, lastRunKind, loadFiles, runSource, saveFile, stopRun, usePlayground } from "./store.ts";
import { playgroundSettings } from "./shared.ts";

/** True while focus is inside the playground editor or its terminal (Ctrl+S saves the playground file). */
const playgroundFocused = () => !!document.activeElement?.closest("[data-playground-root]");

export default definePlugin({
  id: "playground",
  name: "Playground",
  description: "Run code with a live terminal — no problem or tests needed. Files are saved in a folder you choose.",

  activate(ctx) {
    initStore(ctx);

    async function runProblemInTerminal() {
      const { problem, buffers } = ctx.workspace.get();
      if (!problem) return ctx.notify.info("Open a problem first");
      await ctx.workspace.saveAll();
      ctx.panels.open("playground.terminal");
      runSource(problem.meta.mainFile, buffers[problem.meta.mainFile]?.content ?? "", "problem");
      setTimeout(focusTerminal, 50);
    }
    ctx.settings.contribute(playgroundSettings);
    void loadFiles().catch((e) => ctx.notify.error("Could not load playground files", String(e?.message ?? e)));
    ctx.events.on("settings:changed", ({ key }) => {
      if (key === "playground.folder") void loadFiles().catch(() => {});
    });

    ctx.panels.register({ id: "playground.editor", title: "Playground", icon: FlaskConical, component: PlaygroundPanel, placement: "center", order: 20 });
    ctx.panels.register({ id: "playground.terminal", title: "Terminal", icon: SquareTerminal, component: TerminalPanel, placement: "bottom", order: 5 });
    ctx.layout.registerPreset({ id: "playground", name: "Playground", description: "Playground editor + terminal", panels: ["playground.editor", "playground.terminal"] });

    const open = () => {
      ctx.panels.open("playground.editor");
      ctx.panels.open("playground.terminal");
      ctx.panels.open("playground.editor");
    };
    ctx.commands.register({ id: "playground.open", title: "Open playground", category: "Playground", keybinding: "alt+g", run: open });
    ctx.commands.register({ id: "playground.run", title: "Run playground file", category: "Playground", run: () => runPlayground(ctx) });
    ctx.commands.register({ id: "playground.stop", title: "Stop program", category: "Playground", run: stopRun });
    ctx.commands.register({
      id: "playground.save",
      title: "Save playground file",
      category: "Playground",
      keybinding: "ctrl+s",
      when: playgroundFocused,
      run: () => saveFile(),
    });
    ctx.commands.register({ id: "playground.new", title: "New playground file…", category: "Playground", run: () => newPlaygroundFile(ctx) });
    ctx.newItems.register({
      id: "playground.file",
      label: "Playground file",
      description: "Code with a live terminal — no tests needed",
      icon: FlaskConical,
      command: "playground.new",
      order: 20,
    });
    ctx.commands.register({ id: "playground.saveAsProblem", title: "Save playground file as problem…", category: "Playground", run: () => saveAsProblem(ctx) });
    ctx.commands.register({ id: "playground.download", title: "Download playground file", category: "Playground", run: downloadPlaygroundFile });
    ctx.commands.register({ id: "playground.runProblem", title: "Run problem in terminal", category: "Run", run: runProblemInTerminal });

    // The top-bar Run button / Ctrl+Enter: the playground file while the Playground is active,
    // and problems in Playground mode in the terminal.
    const busy = () => usePlayground((s) => s.run.phase === "running" || s.run.phase === "compiling");
    ctx.run.register({
      id: "playground.file",
      label: "Run playground file",
      icon: FlaskConical,
      priority: 20,
      applies: () => {
        const active = ctx.panels.active();
        return active === "playground.editor" || (active === "playground.terminal" && lastRunKind !== "problem");
      },
      run: () => runPlayground(ctx),
      useBusy: busy,
      stop: stopRun,
    });
    ctx.run.register({
      id: "playground.problem",
      label: "Run in terminal",
      icon: SquareTerminal,
      priority: 10,
      applies: () => ctx.workspace.get().problem?.meta.runMode === "playground",
      run: runProblemInTerminal,
      useBusy: busy,
      stop: stopRun,
    });
  },
});
