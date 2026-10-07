import {
  CircleHelp,
  Code2,
  FileCode2,
  FolderOpen,
  Hash,
  LayoutTemplate,
  ListOrdered,
  PanelTop,
  Save,
  SquareChevronRight,
  X,
} from "lucide-react";
import type { WebPluginContext } from "@cp-ide/plugin-api/web";
import { usePalette } from "./store.ts";
import type { PaletteProvider } from "./types.ts";

const MRU_KEY = "cp-ide.palette.mru";
const STATUS = { todo: "to do", attempted: "tried", solved: "solved ✓" } as const;

function readMru(): string[] {
  try {
    return JSON.parse(localStorage.getItem(MRU_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function pushMru(id: string) {
  try {
    localStorage.setItem(MRU_KEY, JSON.stringify([id, ...readMru().filter((x) => x !== id)].slice(0, 30)));
  } catch {}
}

export function builtinProviders(ctx: WebPluginContext): PaletteProvider[] {
  const kb = (commandId: string) => {
    const k = ctx.commands.list().find((c) => c.id === commandId)?.keybinding;
    return k ? ctx.commands.formatKeybinding(k) : undefined;
  };

  const problems: PaletteProvider = {
    id: "problems",
    prefix: "",
    title: "Problems",
    order: 10,
    provide: () => {
      const { problems, problem } = ctx.workspace.get();
      return [...problems]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((p) => ({
          id: `problem:${p.id}`,
          label: p.name,
          description: `${p.platform} / ${p.group}`,
          hint: [p.id === problem?.id ? "open" : "", p.language === "cpp" ? "C++" : "Py", STATUS[p.status]].filter(Boolean).join(" · "),
          keywords: `${p.platform} ${p.group} ${p.tags.join(" ")}`,
          icon: FolderOpen,
          run: async () => {
            await ctx.workspace.openProblem(p.id);
            ctx.panels.open("core.editor");
          },
        }));
    },
  };

  const files: PaletteProvider = {
    id: "files",
    prefix: "",
    title: "Files in this problem",
    order: 0,
    provide: () => {
      const { buffers, activeFile, problem } = ctx.workspace.get();
      if (!problem) return [];
      return Object.keys(buffers).map((f) => ({
        id: `file:${f}`,
        label: f,
        description: f === problem.meta.mainFile ? "main file" : undefined,
        hint: f === activeFile ? "active" : undefined,
        icon: FileCode2,
        run: () => {
          ctx.workspace.setActiveFile(f);
          ctx.panels.open("core.editor");
          void ctx.commands.execute("editor.focus").catch(() => {});
        },
      }));
    },
  };

  const commands: PaletteProvider = {
    id: "commands",
    prefix: ">",
    title: "Commands",
    placeholder: "Run a command",
    provide: () => {
      const mru = readMru();
      const rank = (id: string) => {
        const i = mru.indexOf(id);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      return ctx.commands
        .list()
        .filter((c) => !c.id.startsWith("palette.") && c.id !== "workbench.commandPalette" && c.id !== "workbench.quickOpen")
        .sort((a, b) => rank(a.id) - rank(b.id) || `${a.category ?? ""}${a.title}`.localeCompare(`${b.category ?? ""}${b.title}`))
        .map((c) => ({
          id: `cmd:${c.id}`,
          label: c.category ? `${c.category}: ${c.title}` : c.title,
          description: rank(c.id) < 5 ? "recently used" : undefined,
          hint: c.keybinding ? ctx.commands.formatKeybinding(c.keybinding) : undefined,
          keywords: c.id,
          icon: SquareChevronRight,
          run: () => {
            pushMru(c.id);
            return ctx.commands.execute(c.id);
          },
        }));
    },
  };

  const panels: PaletteProvider = {
    id: "panels",
    prefix: "#",
    title: "Panels",
    placeholder: "Open or focus a panel",
    provide: () => {
      const all = [...ctx.panels.list()].sort((a, b) => a.title.localeCompare(b.title));
      const open = all.filter((p) => ctx.panels.isOpen(p.id));
      return [
        ...all.map((p) => ({
          id: `panel:${p.id}`,
          label: p.title,
          description: ctx.panels.isOpen(p.id) ? "open" : undefined,
          hint: kb(`view.toggle.${p.id}`),
          keywords: `${p.id} ${p.placement ?? "center"} open show focus`,
          icon: p.icon ?? PanelTop,
          run: () => ctx.panels.open(p.id),
        })),
        ...open.map((p) => ({
          id: `panel-close:${p.id}`,
          label: `Close ${p.title}`,
          keywords: "close hide",
          icon: X,
          run: () => ctx.panels.close(p.id),
        })),
      ];
    },
  };

  const layouts: PaletteProvider = {
    id: "layouts",
    prefix: "!",
    title: "Layouts",
    placeholder: "Switch layout",
    provide: () => [
      ...ctx.layout.listPresets().map((p) => ({
        id: `layout:${p.id}`,
        label: p.name,
        description: p.description,
        hint: kb(`layout.preset.${p.id}`),
        icon: LayoutTemplate,
        run: () => ctx.layout.applyPreset(p.id),
      })),
      { id: "layout:save", label: "Save current layout…", icon: Save, run: () => ctx.commands.execute("layout.save") },
      { id: "layout:reset", label: "Reset layout", icon: LayoutTemplate, run: () => ctx.layout.reset() },
    ],
  };

  const gotoLine: PaletteProvider = {
    id: "goto-line",
    prefix: ":",
    title: "Go to line",
    placeholder: "line[:column] in the code editor",
    filter: false,
    provide: (q) => {
      const m = /^(\d+)(?:[:,\s]+(\d+))?$/.exec(q.trim());
      if (!m) return [{ id: "line:hint", label: "Type a line number, e.g. :42 or :42:5", icon: ListOrdered, run: () => {}, keepOpen: true }];
      const line = Number(m[1]);
      const col = m[2] ? Number(m[2]) : undefined;
      return [
        {
          id: "line:go",
          label: col ? `Go to line ${line}, column ${col}` : `Go to line ${line}`,
          icon: Code2,
          run: () => {
            ctx.panels.open("core.editor");
            return ctx.commands.execute("editor.revealLine", line, col ?? 1);
          },
        },
      ];
    },
  };

  const help: PaletteProvider = {
    id: "help",
    prefix: "?",
    title: "Palette modes",
    provide: () => {
      // Read the live provider list so modes added by other plugins show up too.
      const modes = usePalette.getState().providers.filter((p) => p.prefix && p.prefix !== "?");
      return [
        { id: "help:default", label: "Problems and files", description: "type without a prefix", icon: FolderOpen, keepOpen: true, run: (pal) => pal.setQuery("") },
        ...modes.map((p) => ({
          id: `help:${p.id}`,
          label: `${p.prefix}  ${p.title}`,
          description: p.placeholder,
          icon: p.prefix === "#" ? Hash : CircleHelp,
          keepOpen: true,
          run: (pal: { setQuery(q: string): void }) => pal.setQuery(p.prefix),
        })),
      ];
    },
  };

  return [files, problems, commands, panels, layouts, gotoLine, help];
}
