import type { WebPluginContext } from "@cp-ide/plugin-api/web";
import type { ProblemStatus, ProblemSummary } from "@cp-ide/shared";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function find(ctx: WebPluginContext, id?: string): ProblemSummary | undefined {
  const { problems, problem } = ctx.workspace.get();
  const target = id ?? problem?.id;
  return problems.find((p) => p.id === target);
}

export async function renameProblem(ctx: WebPluginContext, id?: string) {
  const p = find(ctx, id);
  if (!p) return;
  const name = await ctx.ui.prompt({
    title: "Rename problem",
    value: p.name,
    validate: (v) => (!v.trim() ? "Enter a name" : undefined),
  });
  if (!name?.trim() || name.trim() === p.name) return;
  await ctx.workspace.renameProblem(p.id, name.trim()).catch((e) => ctx.notify.error("Could not rename", errorText(e)));
}

/** Pick an existing platform/contest (or type a new "platform / contest") and move there. */
export async function moveProblem(ctx: WebPluginContext, id?: string) {
  const p = find(ctx, id);
  if (!p) return;
  const locations = new Map<string, { platform: string; group: string }>();
  for (const x of ctx.workspace.get().problems) locations.set(`${x.platform} / ${x.group}`, { platform: x.platform, group: x.group });
  locations.delete(`${p.platform} / ${p.group}`);
  const NEW = { platform: "", group: "" };
  const choice = await ctx.ui.quickPick(
    [
      { label: "New location…", description: "type platform / contest", value: NEW },
      ...[...locations].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })),
    ],
    { title: `Move "${p.name}"`, placeholder: "Choose a platform / contest" },
  );
  if (!choice) return;
  let target = choice;
  if (choice === NEW) {
    const text = await ctx.ui.prompt({
      title: "Move to (platform / contest)",
      value: `${p.platform} / `,
      validate: (v) => (v.split("/").map((x) => x.trim()).filter(Boolean).length !== 2 ? "Use the form: platform / contest" : undefined),
    });
    if (!text) return;
    const [platform, group] = text.split("/").map((x) => x.trim());
    target = { platform: platform!, group: group! };
  }
  await ctx.workspace.moveProblem(p.id, target).catch((e) => ctx.notify.error("Could not move", errorText(e)));
}

/** Move to the trash, with an Undo action on the toast. */
export async function deleteProblem(ctx: WebPluginContext, id?: string) {
  const p = find(ctx, id);
  if (!p) return;
  const ok = await ctx.ui.confirm({
    title: `Delete "${p.name}"?`,
    message: "The folder is moved to .trash inside your problems root, so it can be restored.",
    confirmLabel: "Delete",
    destructive: true,
  });
  if (!ok) return;
  try {
    const trashId = await ctx.workspace.deleteProblem(p.id);
    ctx.notify.success(`Deleted "${p.name}"`, undefined, {
      label: "Undo",
      run: async () => {
        try {
          const restored = await ctx.workspace.restoreProblem(trashId);
          await ctx.workspace.openProblem(restored);
        } catch (e) {
          ctx.notify.error("Could not restore", errorText(e));
        }
      },
    });
  } catch (e) {
    ctx.notify.error("Could not delete", errorText(e));
  }
}

export function setStatus(ctx: WebPluginContext, id: string, status: ProblemStatus) {
  return ctx.workspace.updateMeta({ status }, id).catch((e) => ctx.notify.error("Could not update status", errorText(e)));
}

export function copyPath(ctx: WebPluginContext, id?: string) {
  const p = find(ctx, id);
  if (!p) return;
  const root = ctx.workspace.get().problemsRoot;
  const sep = root.includes("\\") ? "\\" : "/";
  const full = `${root}${sep}${p.id.split("/").join(sep)}`;
  void navigator.clipboard.writeText(full).then(
    () => ctx.notify.info("Path copied", full),
    () => ctx.notify.error("Could not copy", full),
  );
}
