import { BookMarked, Code2, FilePlus2, FolderTree, Info, Keyboard, ListChecks, Settings, SquareTerminal, Terminal, Zap } from "lucide-react";
import { focusedEditor } from "@cp-ide/editor";
import { type PanelContribution, definePlugin } from "@cp-ide/plugin-api/web";
import { EditorPanel, deleteFile, focusEditor, installDiagnostics, newFile, renameFile, revealLine } from "./editor/EditorPanel.tsx";
import { TestsPanel, importTestFiles } from "./tests/TestsPanel.tsx";
import { CustomInputPanel, readCustomInput } from "./tests/CustomInputPanel.tsx";
import { OutputPanel } from "./output/OutputPanel.tsx";
import { ExplorerPanel } from "./explorer/ExplorerPanel.tsx";
import { ProblemPanel } from "./problem/ProblemPanel.tsx";
import { SettingsPanel } from "./settings/SettingsPanel.tsx";
import { KeybindingsPanel } from "./settings/KeybindingsPanel.tsx";
import { openNewProblemDialog } from "./chrome/NewProblemDialog.tsx";
import { LanguageStatus, RootStatus, RunButton, SaveStatus, TestsStatus } from "./chrome/items.tsx";
import { NewMenu } from "./chrome/NewItems.tsx";
import { LanguageServerStatus } from "./chrome/LanguageServerStatus.tsx";
import { IndentationStatus, changeIndentation } from "./editor/indentation.tsx";
import { applyLayout, deleteLayout, saveLayout } from "./chrome/layouts.ts";
import { copyPath, deleteProblem, moveProblem, renameProblem } from "./explorer/actions.ts";
import { LibraryPanel } from "./library/LibraryPanel.tsx";
import { MODES, setMode } from "./problem/ModeControl.tsx";
import { insertText, pickSnippet, registerSnippetCompletions, registerSnippetPaletteMode } from "./library/snippets.ts";

/**
 * The built-in tools. Everything here goes through the public plugin API — a third-party
 * plugin could replace any of it.
 */
export default definePlugin({
  id: "core",
  name: "Core",
  description: "Explorer, editor, tests, output, problem info, settings, palette and layouts.",
  required: true,

  activate(ctx) {
    // ---- panels ----
    const panels: (PanelContribution & { keybinding?: string })[] = [
      { id: "core.explorer", title: "Problems", icon: FolderTree, component: ExplorerPanel, placement: "left", defaultOpen: true, keybinding: "ctrl+b" },
      { id: "core.editor", title: "Code", icon: Code2, component: EditorPanel, placement: "center", defaultOpen: true, order: 0, keybinding: "alt+1" },
      { id: "core.tests", title: "Tests", icon: ListChecks, component: TestsPanel, placement: "right", defaultOpen: true, order: 0, keybinding: "alt+2" },
      { id: "core.problem", title: "Problem", icon: Info, component: ProblemPanel, placement: "right", defaultOpen: true, order: 1, keybinding: "alt+3" },
      { id: "core.output", title: "Output", icon: Terminal, component: OutputPanel, placement: "bottom", defaultOpen: true, order: 0, keybinding: "ctrl+j" },
      { id: "core.custom", title: "Custom Input", icon: SquareTerminal, component: CustomInputPanel, placement: "bottom", defaultOpen: true, order: 1, keybinding: "alt+4" },
      { id: "core.settings", title: "Settings", icon: Settings, component: SettingsPanel, placement: "center", order: 10 },
      { id: "core.keybindings", title: "Keyboard Shortcuts", icon: Keyboard, component: KeybindingsPanel, placement: "center", order: 11 },
      { id: "core.library", title: "Templates & Snippets", icon: BookMarked, component: LibraryPanel, placement: "center", order: 12 },
    ];

    for (const { keybinding, ...panel } of panels) {
      ctx.panels.register(panel);
      ctx.commands.register({
        id: `view.toggle.${panel.id}`,
        title: `Toggle ${panel.title}`,
        category: "View",
        keybinding,
        run: () => ctx.panels.toggle(panel.id),
      });
    }

    // ---- layouts ----
    ctx.layout.registerPreset({ id: "focus", name: "Focus", description: "Code + tests", panels: ["core.editor", "core.tests"] });
    ctx.layout.registerPreset({ id: "zen", name: "Zen", description: "Code only", panels: ["core.editor"] });
    ctx.layout.registerPreset({
      id: "everything",
      name: "Everything",
      description: "All core panels",
      panels: ["core.explorer", "core.editor", "core.tests", "core.problem", "core.output", "core.custom"],
    });
    const presetKeys: Record<string, string> = { default: "ctrl+alt+1", focus: "ctrl+alt+2", zen: "ctrl+alt+3", everything: "ctrl+alt+4" };
    for (const p of ctx.layout.listPresets().filter((x) => !x.saved)) {
      ctx.commands.register({ id: `layout.preset.${p.id}`, title: `Use ${p.name} layout`, category: "Layout", keybinding: presetKeys[p.id], run: () => ctx.layout.applyPreset(p.id) });
    }
    ctx.commands.register({ id: "layout.apply", title: "Apply layout…", category: "Layout", run: () => applyLayout(ctx) });
    ctx.commands.register({ id: "layout.save", title: "Save current layout…", category: "Layout", run: () => saveLayout(ctx) });
    ctx.commands.register({ id: "layout.deleteSaved", title: "Delete saved layout…", category: "Layout", run: () => deleteLayout(ctx) });
    ctx.commands.register({ id: "layout.reset", title: "Reset layout", category: "Layout", run: () => ctx.layout.reset() });

    // ---- workbench ----
    ctx.commands.register({ id: "settings.open", title: "Open settings", category: "Preferences", keybinding: "ctrl+,", run: () => ctx.panels.open("core.settings") });
    ctx.commands.register({ id: "keybindings.open", title: "Keyboard shortcuts", category: "Preferences", keybinding: "ctrl+alt+k", run: () => ctx.panels.open("core.keybindings") });

    // ---- run ----
    ctx.commands.register({ id: "runner.runAll", title: "Run all tests", category: "Run", run: () => ctx.runner.run() });
    // The top-bar Run button and Ctrl+Enter run the current target: tests by default; plugins add
    // others (the playground file, problems in Playground mode, …).
    ctx.commands.register({ id: "run.primary", title: "Run", category: "Run", keybinding: "ctrl+enter", run: () => ctx.run.runCurrent() });
    ctx.run.register({
      id: "core.tests",
      label: "Run tests",
      priority: 0,
      applies: () => !!ctx.workspace.get().problem,
      run: () => ctx.runner.run(),
      useBusy: () => ctx.runner.use((s) => s.phase !== "idle"),
    });
    ctx.commands.register({
      id: "runner.runCustom",
      title: "Run with custom input",
      category: "Run",
      keybinding: "ctrl+shift+enter",
      run: () => {
        const id = ctx.workspace.get().problem?.id;
        if (!id) return;
        ctx.panels.open("core.custom");
        return ctx.runner.runCustom(readCustomInput(id));
      },
    });

    // ---- files & problems ----
    ctx.commands.register({ id: "workspace.save", title: "Save", category: "File", keybinding: "ctrl+s", run: () => ctx.workspace.saveAll() });
    ctx.commands.register({ id: "workspace.newScratch", title: "New scratch problem", category: "File", keybinding: "alt+n", run: () => ctx.workspace.createScratch() });
    ctx.commands.register({ id: "workspace.newProblem", title: "New problem…", category: "File", keybinding: "alt+shift+n", run: openNewProblemDialog });
    ctx.commands.register({ id: "editor.newFile", title: "New file in problem…", category: "File", run: (name?: string) => newFile(ctx, name) });
    ctx.commands.register({ id: "editor.renameFile", title: "Rename file…", category: "File", keybinding: "f2", run: (name?: string) => renameFile(ctx, name) });
    // In a code editor F2 renames the symbol under the cursor (language server); elsewhere it renames the file.
    ctx.commands.register({
      id: "editor.renameSymbol",
      title: "Rename symbol",
      category: "Editor",
      keybinding: "f2",
      when: () => !!focusedEditor(),
      run: () => focusedEditor()?.trigger("keyboard", "editor.action.rename", {}),
    });
    ctx.commands.register({ id: "editor.deleteFile", title: "Delete file…", category: "File", run: (name?: string) => deleteFile(ctx, name) });
    ctx.commands.register({ id: "problems.rename", title: "Rename problem…", category: "Problem", run: (id?: string) => renameProblem(ctx, id) });
    ctx.commands.register({ id: "problems.move", title: "Move problem to…", category: "Problem", run: (id?: string) => moveProblem(ctx, id) });
    ctx.commands.register({ id: "problems.delete", title: "Delete problem…", category: "Problem", run: (id?: string) => deleteProblem(ctx, id) });
    ctx.commands.register({ id: "problems.copyPath", title: "Copy problem folder path", category: "Problem", run: (id?: string) => copyPath(ctx, id) });
    for (const status of ["todo", "attempted", "solved"] as const) {
      ctx.commands.register({
        id: `problems.mark.${status}`,
        title: `Mark as ${status === "todo" ? "to do" : status}`,
        category: "Problem",
        run: () => ctx.workspace.updateMeta({ status }),
      });
    }

    for (const m of MODES) {
      ctx.commands.register({ id: `problems.mode.${m.id}`, title: `Set mode: ${m.label}`, category: "Problem", run: () => setMode(ctx, m.id) });
    }
    ctx.commands.register({
      id: "problems.openInteractor",
      title: "Open interactor file",
      category: "Problem",
      run: () => {
        const p = ctx.workspace.get().problem;
        if (!p?.meta.interactive) return ctx.notify.info("Not an interactive problem", "Switch it with the Mode control in the Problem panel, or the command Problem: Set mode: Interactive.");
        ctx.workspace.setActiveFile(p.meta.interactor ?? "interactor.cpp");
        ctx.panels.open("core.editor");
      },
    });

    // ---- library ----
    ctx.commands.register({ id: "library.open", title: "Templates & snippets", category: "Preferences", run: () => ctx.panels.open("core.library") });
    ctx.commands.register({ id: "snippets.insert", title: "Insert snippet…", category: "Editor", keybinding: "ctrl+alt+i", run: () => pickSnippet(ctx) });
    ctx.commands.register({ id: "editor.insertText", title: "Insert text at cursor", category: "Editor", run: (text: string) => insertText(String(text ?? "")) });
    registerSnippetCompletions(ctx);
    registerSnippetPaletteMode(ctx);

    // ---- editor ----
    ctx.commands.register({ id: "editor.revealLine", title: "Go to line", category: "Editor", run: (line: number, column?: number) => revealLine(line, column) });
    ctx.commands.register({ id: "editor.focus", title: "Focus editor", category: "Editor", keybinding: "alt+e", run: focusEditor });
    ctx.commands.register({
      id: "editor.toggleVim",
      title: "Toggle Vim mode",
      category: "Editor",
      run: () => ctx.settings.set("editor.vimMode", !ctx.settings.get("editor.vimMode")),
    });

    // ---- tests ----
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
    ctx.commands.register({ id: "tests.import", title: "Import .in/.out files as tests", category: "Tests", run: () => importTestFiles(ctx) });

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
    ctx.newItems.register({ id: "core.scratch", label: "Scratch problem", description: "An untitled problem, ready to code", icon: Zap, command: "workspace.newScratch", order: 0 });
    ctx.newItems.register({ id: "core.problem", label: "Problem…", description: "Name, platform, limits, template and mode", icon: FilePlus2, command: "workspace.newProblem", order: 10 });
    ctx.toolbar.register({ id: "core.run", order: 10, component: RunButton });
    ctx.statusBar.register({ id: "core.language", align: "left", order: 0, component: LanguageStatus });
    ctx.statusBar.register({ id: "core.root", align: "left", order: 10, component: RootStatus });
    ctx.statusBar.register({ id: "core.languageServers", align: "right", order: -10, component: LanguageServerStatus });
    ctx.statusBar.register({ id: "core.indentation", align: "right", order: -30, component: IndentationStatus });
    ctx.commands.register({ id: "editor.changeIndentation", title: "Change indentation of this file…", category: "Editor", run: () => changeIndentation(ctx) });
    ctx.commands.register({ id: "languageServers.restart", title: "Restart language servers", category: "Editor", run: () => ctx.languageServers.restart() });
    ctx.statusBar.register({ id: "core.tests", align: "right", order: 0, component: TestsStatus });
    ctx.statusBar.register({ id: "core.save", align: "right", order: 10, component: SaveStatus });
  },
});
