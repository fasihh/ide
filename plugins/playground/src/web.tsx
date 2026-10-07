import { FlaskConical, SquareTerminal } from "lucide-react";
import { definePlugin } from "@cp-ide/plugin-api/web";
import { PlaygroundPanel, downloadPlaygroundFile, newPlaygroundFile, runPlayground, saveAsProblem } from "./PlaygroundPanel.tsx";
import { TerminalPanel, focusTerminal } from "./TerminalPanel.tsx";
import { initStore, loadFiles, runSource, saveFile, stopRun } from "./store.ts";
import { playgroundSettings } from "./shared.ts";

/** True while focus is inside the playground editor or its terminal. */
const playgroundFocused = () => !!document.activeElement?.closest("[data-playground-root]");

export default definePlugin({
  id: "playground",
  name: "Playground",
  description: "Run code with a live terminal — no problem or tests needed. Files are saved in a folder you choose.",

  activate(ctx) {
    initStore(ctx);
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
    ctx.commands.register({
      id: "playground.run",
      title: "Run playground file",
      category: "Playground",
      keybinding: "ctrl+enter",
      when: playgroundFocused,
      run: () => runPlayground(ctx),
    });
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
    ctx.commands.register({ id: "playground.saveAsProblem", title: "Save playground file as problem…", category: "Playground", run: () => saveAsProblem(ctx) });
    ctx.commands.register({ id: "playground.download", title: "Download playground file", category: "Playground", run: downloadPlaygroundFile });
    ctx.commands.register({
      id: "playground.runProblem",
      title: "Run problem in terminal",
      category: "Run",
      run: async () => {
        const { problem, buffers } = ctx.workspace.get();
        if (!problem) return ctx.notify.info("Open a problem first");
        await ctx.workspace.saveAll();
        ctx.panels.open("playground.terminal");
        runSource(problem.meta.mainFile, buffers[problem.meta.mainFile]?.content ?? "");
        setTimeout(focusTerminal, 50);
      },
    });
  },
});
