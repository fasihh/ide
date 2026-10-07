import type { WebPluginContext } from "@cp-ide/plugin-api/web";

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
