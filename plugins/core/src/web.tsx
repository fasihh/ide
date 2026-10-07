import { Code2, FolderTree, Info, ListChecks, Settings, Terminal } from "lucide-react";
import { type PanelContribution, definePlugin } from "@cp-ide/plugin-api/web";
import { EditorPanel, focusEditor, installDiagnostics, revealLine } from "./editor/EditorPanel.tsx";
import { TestsPanel } from "./tests/TestsPanel.tsx";
import { OutputPanel } from "./output/OutputPanel.tsx";
import { ExplorerPanel } from "./explorer/ExplorerPanel.tsx";
import { ProblemPanel } from "./problem/ProblemPanel.tsx";
import { SettingsPanel } from "./settings/SettingsPanel.tsx";
import { openNewProblemDialog } from "./chrome/NewProblemDialog.tsx";
import { LanguageStatus, NewMenu, RootStatus, RunButton, SaveStatus, TestsStatus } from "./chrome/items.tsx";

/**
 * The built-in tools. Everything here goes through the public plugin API — a third-party
 * plugin could replace any of it.
 */
export default definePlugin({
  id: "core",
  name: "Core",
  description: "Explorer, editor, tests, output, problem info and settings.",
  required: true,

  activate(ctx) {
    // ---- panels ----
    const panels: (PanelContribution & { keybinding?: string })[] = [
      { id: "core.explorer", title: "Problems", icon: FolderTree, component: ExplorerPanel, placement: "left", defaultOpen: true, keybinding: "ctrl+b" },
      { id: "core.editor", title: "Code", icon: Code2, component: EditorPanel, placement: "center", defaultOpen: true, order: 0, keybinding: "alt+1" },
      { id: "core.tests", title: "Tests", icon: ListChecks, component: TestsPanel, placement: "right", defaultOpen: true, order: 0, keybinding: "alt+2" },
      { id: "core.problem", title: "Problem", icon: Info, component: ProblemPanel, placement: "right", defaultOpen: true, order: 1, keybinding: "alt+3" },
      { id: "core.output", title: "Output", icon: Terminal, component: OutputPanel, placement: "bottom", defaultOpen: true, keybinding: "ctrl+j" },
      { id: "core.settings", title: "Settings", icon: Settings, component: SettingsPanel, placement: "center", order: 10 },
    ];

    for (const { keybinding, ...panel } of panels) {
      ctx.panels.register(panel);
      if (keybinding) {
        ctx.commands.register({
          id: `view.toggle.${panel.id}`,
          title: `Toggle ${panel.title}`,
          category: "View",
          keybinding,
          run: () => ctx.panels.toggle(panel.id),
        });
      }
    }

    // ---- commands ----
    ctx.commands.register({ id: "runner.runAll", title: "Run all tests", category: "Run", keybinding: "ctrl+enter", run: () => ctx.runner.run() });
    ctx.commands.register({ id: "workspace.save", title: "Save", category: "File", keybinding: "ctrl+s", run: () => ctx.workspace.saveAll() });
    ctx.commands.register({
      id: "workspace.newScratch",
      title: "New scratch problem",
      category: "File",
      keybinding: "alt+n",
      run: () => ctx.workspace.createScratch(),
    });
    ctx.commands.register({ id: "workspace.newProblem", title: "New problem…", category: "File", keybinding: "alt+shift+n", run: openNewProblemDialog });
    ctx.commands.register({
      id: "tests.add",
      title: "Add test",
      category: "Tests",
      keybinding: "alt+t",
      run: () => {
        ctx.workspace.addTest();
        ctx.panels.open("core.tests");
      },
    });
    ctx.commands.register({ id: "settings.open", title: "Open settings", category: "Preferences", keybinding: "ctrl+,", run: () => ctx.panels.open("core.settings") });
    ctx.commands.register({ id: "editor.revealLine", title: "Go to line", category: "Editor", run: (line: number, column?: number) => revealLine(line, column) });
    ctx.commands.register({ id: "editor.focus", title: "Focus editor", category: "Editor", keybinding: "alt+e", run: focusEditor });

    // ---- reactions ----
    installDiagnostics(ctx);
    ctx.events.on("run:compiled", ({ result }) => {
      if (!result.ok) ctx.panels.open("core.output");
    });
    // Running a todo problem marks it attempted. "Solved" stays manual — passing samples isn't AC.
    ctx.events.on("run:finished", () => {
      const problem = ctx.workspace.get().problem;
      if (problem?.meta.status === "todo") void ctx.workspace.updateMeta({ status: "attempted" });
    });

    // ---- chrome ----
    ctx.toolbar.register({ id: "core.new", order: 0, component: NewMenu });
    ctx.toolbar.register({ id: "core.run", order: 10, component: RunButton });
    ctx.statusBar.register({ id: "core.language", align: "left", order: 0, component: LanguageStatus });
    ctx.statusBar.register({ id: "core.root", align: "left", order: 10, component: RootStatus });
    ctx.statusBar.register({ id: "core.tests", align: "right", order: 0, component: TestsStatus });
    ctx.statusBar.register({ id: "core.save", align: "right", order: 10, component: SaveStatus });
  },
});

