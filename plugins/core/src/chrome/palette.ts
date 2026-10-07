import type { WebPluginContext } from "@cp-ide/plugin-api/web";

const MRU_KEY = "cp-ide.palette.mru";
const STATUS_LABEL = { todo: "to do", attempted: "attempted", solved: "solved ✓" } as const;

function readMru(): string[] {
  try {
    return JSON.parse(localStorage.getItem(MRU_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function pushMru(id: string) {
  try {
    localStorage.setItem(MRU_KEY, JSON.stringify([id, ...readMru().filter((x) => x !== id)].slice(0, 20)));
  } catch {}
}

/** Ctrl+Shift+P: every registered command, recently used first. */
export async function commandPalette(ctx: WebPluginContext) {
  const mru = readMru();
  const rank = (id: string) => {
    const i = mru.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const commands = ctx.commands
    .list()
    .filter((c) => c.id !== "workbench.commandPalette")
    .sort((a, b) => rank(a.id) - rank(b.id) || `${a.category ?? ""}${a.title}`.localeCompare(`${b.category ?? ""}${b.title}`));
  const id = await ctx.ui.quickPick(
    commands.map((c) => ({
      label: c.category ? `${c.category}: ${c.title}` : c.title,
      hint: c.keybinding ? ctx.commands.formatKeybinding(c.keybinding) : undefined,
      description: mru.includes(c.id) && rank(c.id) < 5 ? "recently used" : undefined,
      value: c.id,
    })),
    { placeholder: "Type a command" },
  );
  if (!id) return;
  pushMru(id);
  await ctx.commands.execute(id);
}

/** Ctrl+P: jump to any problem. */
export async function quickOpen(ctx: WebPluginContext) {
  const { problems, problem } = ctx.workspace.get();
  const id = await ctx.ui.quickPick(
    problems
      .filter((p) => p.id !== problem?.id)
      .map((p) => ({
        label: p.name,
        description: `${p.platform} / ${p.group}`,
        hint: [p.language === "cpp" ? "C++" : "Py", STATUS_LABEL[p.status], ...p.tags].join(" · "),
        value: p.id,
      })),
    { placeholder: problems.length ? "Search problems by name, platform or contest" : "No problems yet — Alt+N for a scratch problem" },
  );
  if (id) await ctx.workspace.openProblem(id);
}

export async function applyLayout(ctx: WebPluginContext) {
  const id = await ctx.ui.quickPick(
    ctx.layout.listPresets().map((p) => ({ label: p.name, description: p.description, value: p.id })),
    { placeholder: "Choose a layout" },
  );
  if (id) ctx.layout.applyPreset(id);
}

export async function saveLayout(ctx: WebPluginContext) {
  const name = await ctx.ui.prompt({
    title: "Save current layout as",
    placeholder: "e.g. Contest, Big screen",
    validate: (v) => (!v.trim() ? "Enter a name" : undefined),
  });
  if (!name?.trim()) return;
  ctx.layout.saveCurrent(name.trim());
  ctx.notify.success(`Saved layout "${name.trim()}"`, "Find it in the View menu or Layout: Apply…");
}

export async function deleteLayout(ctx: WebPluginContext) {
  const saved = ctx.layout.listPresets().filter((p) => p.saved);
  if (!saved.length) return ctx.notify.info("No saved layouts");
  const id = await ctx.ui.quickPick(
    saved.map((p) => ({ label: p.name, value: p.id })),
    { placeholder: "Delete which saved layout?" },
  );
  if (id) ctx.layout.deleteSaved(id);
}
