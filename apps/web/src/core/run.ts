import { create } from "zustand";
import type { RunApi, RunTarget } from "@cp-ide/plugin-api/web";
import { toDisposable } from "@cp-ide/plugin-api/web";
import { useLayout } from "./layout.ts";
import { useWorkspace } from "./workspace.ts";
import { reportError } from "./notify.ts";

const useTargets = create<{ targets: RunTarget[] }>(() => ({ targets: [] }));

function current(): RunTarget | undefined {
  const sorted = [...useTargets.getState().targets].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const t of sorted) {
    try {
      if (t.applies()) return t;
    } catch (err) {
      console.error(`[run] target ${t.id} failed`, err);
    }
  }
  return undefined;
}

export const runApi: RunApi = {
  register(target) {
    useTargets.setState((s) => ({ targets: [...s.targets.filter((t) => t.id !== target.id), target] }));
    return toDisposable(() => useTargets.setState((s) => ({ targets: s.targets.filter((t) => t !== target) })));
  },
  current,
  useCurrent() {
    // Re-render on whatever targets typically depend on, then evaluate.
    useTargets((s) => s.targets);
    useLayout((s) => s.active);
    useWorkspace((s) => s.problem?.meta);
    return current();
  },
  async runCurrent() {
    const t = current();
    if (!t) return;
    await Promise.resolve()
      .then(() => t.run())
      .catch(reportError(`${t.label} failed`));
  },
};
