import { create } from "zustand";
import type { WorkspaceApi, WorkspaceState } from "@cp-ide/plugin-api/web";
import { toDisposable } from "@cp-ide/plugin-api/web";
import type { Problem, TestCase } from "@cp-ide/shared";
import { api, unwrap } from "../api.ts";
import { events } from "./registry.ts";
import { getSetting } from "./settings.ts";
import { reportError } from "./notify.ts";

const LAST_PROBLEM_KEY = "cp-ide.lastProblem";
const TESTS_SAVE_DELAY = 400;

export const useWorkspace = create<WorkspaceState>(() => ({
  problems: [],
  problemsLoading: false,
  problemsRoot: "",
  problem: null,
  buffers: {},
  activeFile: null,
}));

const set = useWorkspace.setState;
const get = useWorkspace.getState;

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let testsTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleAutoSave(file: string) {
  clearTimeout(saveTimers.get(file));
  if (!getSetting("editor.autoSave")) return;
  saveTimers.set(
    file,
    setTimeout(() => void workspace.save(file).catch(reportError("Auto save failed")), getSetting("editor.autoSaveDelayMs")),
  );
}

function scheduleTestsSave() {
  clearTimeout(testsTimer);
  testsTimer = setTimeout(() => void flushTests(), TESTS_SAVE_DELAY);
}

async function flushTests() {
  clearTimeout(testsTimer);
  testsTimer = undefined;
  const p = get().problem;
  if (!p) return;
  await unwrap(api.problems.tests.$put({ json: { id: p.id, tests: p.tests } })).catch(reportError("Could not save tests"));
}

function setProblem(fn: (p: Problem) => Problem) {
  const p = get().problem;
  if (p) set({ problem: fn(p) });
}

export const workspace: Omit<WorkspaceApi, keyof import("@cp-ide/plugin-api/web").StoreHandle<WorkspaceState>> = {
  async refreshProblems() {
    set({ problemsLoading: true });
    try {
      await loadProblems();
    } finally {
      set({ problemsLoading: false });
    }
  },

  renameProblem: (id, name) => relocate(id, { name }),
  moveProblem: (id, target) => relocate(id, target),

  async deleteProblem(id) {
    if (get().problem?.id === id) {
      await workspace.saveAll();
      if (testsTimer) await flushTests();
      workspace.closeProblem();
    }
    const { trashId } = await unwrap(api.problems.trash.$post({ json: { id } }));
    await loadProblems();
    return trashId;
  },

  async restoreProblem(trashId) {
    const p = await unwrap(api.problems.restore.$post({ json: { trashId } }));
    await loadProblems();
    return p.id;
  },

  async openProblem(id) {
    await workspace.saveAll();
    if (testsTimer) await flushTests();
    const problem = await unwrap(api.problems.detail.$get({ query: { id } }));
    const buffers = Object.fromEntries(problem.files.map((f) => [f.name, { content: f.content, saved: f.content }]));
    set({ problem, buffers, activeFile: problem.meta.mainFile });
    localStorage.setItem(LAST_PROBLEM_KEY, id);
    events.emit("problem:opened", { problem });
  },

  closeProblem() {
    const p = get().problem;
    if (!p) return;
    void workspace.saveAll();
    set({ problem: null, buffers: {}, activeFile: null });
    localStorage.removeItem(LAST_PROBLEM_KEY);
    events.emit("problem:closed", { id: p.id });
  },

  async createProblem(input) {
    const problem = await unwrap(api.problems.$post({ json: input }));
    await workspace.refreshProblems();
    await workspace.openProblem(problem.id);
    return problem;
  },

  async createScratch(language) {
    const problem = await unwrap(api.problems.scratch.$post({ json: { language } }));
    await workspace.refreshProblems();
    await workspace.openProblem(problem.id);
    return problem;
  },

  async updateMeta(patch, id) {
    const open = get().problem;
    const target = id ?? open?.id;
    if (!target) return;
    const meta = await unwrap(api.problems.meta.$patch({ json: { id: target, patch } }));
    if (open?.id === target) {
      if (patch.language && meta.mainFile !== open.meta.mainFile) {
        // A new main file may have been created from a template — reload from disk.
        await workspace.openProblem(target);
      } else {
        setProblem((x) => ({ ...x, meta }));
      }
    }
    set((s) => ({ problems: s.problems.map((x) => (x.id === target ? { ...meta, id: target } : x)) }));
  },

  setActiveFile(file) {
    if (get().buffers[file]) set({ activeFile: file });
  },

  setBuffer(file, content) {
    const b = get().buffers[file];
    if (!b || b.content === content) return;
    set((s) => ({ buffers: { ...s.buffers, [file]: { ...b, content } } }));
    scheduleAutoSave(file);
  },

  async save(file) {
    const p = get().problem;
    const name = file ?? get().activeFile;
    if (!p || !name) return;
    const b = get().buffers[name];
    if (!b || b.content === b.saved) return;
    clearTimeout(saveTimers.get(name));
    const content = b.content;
    await unwrap(api.problems.file.$put({ json: { id: p.id, file: name, content } }));
    set((s) => {
      const cur = s.buffers[name];
      return cur ? { buffers: { ...s.buffers, [name]: { ...cur, saved: content } } } : {};
    });
    events.emit("file:saved", { problemId: p.id, file: name });
  },

  async saveAll() {
    await Promise.all(Object.keys(get().buffers).map((f) => workspace.save(f)));
  },

  async createFile(name, content) {
    const p = get().problem;
    if (!p) return;
    applyProblem(await unwrap(api.problems.file.create.$post({ json: { id: p.id, file: name, content } })));
    set({ activeFile: name });
  },

  async renameFile(from, to) {
    const p = get().problem;
    if (!p || from === to) return;
    await workspace.save(from);
    applyProblem(await unwrap(api.problems.file.rename.$post({ json: { id: p.id, from, to } })));
    if (get().activeFile === from || !get().buffers[get().activeFile ?? ""]) set({ activeFile: to });
    await workspace.refreshProblems();
  },

  async deleteFile(name) {
    const p = get().problem;
    if (!p) return;
    clearTimeout(saveTimers.get(name));
    applyProblem(await unwrap(api.problems.file.delete.$post({ json: { id: p.id, file: name } })));
    if (get().activeFile === name) set({ activeFile: get().problem?.meta.mainFile ?? null });
  },

  addTest(test) {
    const tc: TestCase = {
      id: crypto.randomUUID(),
      input: "",
      expected: "",
      isSample: false,
      enabled: true,
      ...test,
    };
    setProblem((p) => ({ ...p, tests: [...p.tests, tc] }));
    scheduleTestsSave();
    return tc;
  },

  updateTest(id, patch) {
    setProblem((p) => ({ ...p, tests: p.tests.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    scheduleTestsSave();
  },

  removeTest(id) {
    setProblem((p) => ({ ...p, tests: p.tests.filter((t) => t.id !== id) }));
    scheduleTestsSave();
  },

  duplicateTest(id) {
    const p = get().problem;
    const i = p?.tests.findIndex((t) => t.id === id) ?? -1;
    if (!p || i < 0) return undefined;
    const copy: TestCase = { ...p.tests[i]!, id: crypto.randomUUID(), isSample: false };
    setProblem((x) => ({ ...x, tests: [...x.tests.slice(0, i + 1), copy, ...x.tests.slice(i + 1)] }));
    scheduleTestsSave();
    return copy;
  },

  moveTest(id, delta) {
    setProblem((p) => {
      const i = p.tests.findIndex((t) => t.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= p.tests.length) return p;
      const tests = [...p.tests];
      [tests[i], tests[j]] = [tests[j]!, tests[i]!];
      return { ...p, tests };
    });
    scheduleTestsSave();
  },
};

/** Refresh the list without the loading spinner (used for background file-change events). */
export const refreshProblemsQuietly = () => loadProblems();

async function loadProblems() {
  const res = await unwrap(api.problems.$get());
  set({ problems: res.problems, problemsRoot: res.root });
}

/** Rename/move via the server; the open problem keeps its buffers and just changes id. */
async function relocate(id: string, target: { name?: string; platform?: string; group?: string }) {
  const isOpen = get().problem?.id === id;
  if (isOpen) {
    await workspace.saveAll();
    if (testsTimer) await flushTests();
  }
  const p = await unwrap(api.problems.move.$post({ json: { id, ...target } }));
  if (isOpen && get().problem?.id === id) {
    set({ problem: p });
    localStorage.setItem(LAST_PROBLEM_KEY, p.id);
  }
  await loadProblems();
  return p.id;
}

/**
 * The open problem's files changed on disk (externally or by our own save). Pull the fresh copy:
 * clean buffers take the disk content, dirty ones keep the user's edits; tests are replaced unless
 * a local tests save is pending.
 */
export async function reconcileFromDisk(ids: string[]) {
  const open = get().problem;
  if (!open || !ids.includes(open.id)) return;
  let fresh: Problem;
  try {
    fresh = await unwrap(api.problems.detail.$get({ query: { id: open.id } }));
  } catch {
    return; // deleted or moved away; the list refresh shows it
  }
  const cur = get();
  if (cur.problem?.id !== open.id) return;
  let changed = false;
  const buffers: WorkspaceState["buffers"] = {};
  for (const f of fresh.files) {
    const prev = cur.buffers[f.name];
    if (!prev) {
      buffers[f.name] = { content: f.content, saved: f.content };
      changed = true;
    } else if (prev.content !== prev.saved) {
      buffers[f.name] = { content: prev.content, saved: f.content };
      changed ||= prev.saved !== f.content;
    } else {
      buffers[f.name] = { content: f.content, saved: f.content };
      changed ||= prev.content !== f.content;
    }
  }
  // Files removed on disk disappear unless they hold unsaved edits.
  for (const [name, b] of Object.entries(cur.buffers)) {
    if (buffers[name]) continue;
    if (b.content !== b.saved) buffers[name] = b;
    else changed = true;
  }
  const tests = testsTimer ? cur.problem!.tests : fresh.tests;
  changed ||= JSON.stringify(tests) !== JSON.stringify(cur.problem!.tests) || JSON.stringify(fresh.meta) !== JSON.stringify(cur.problem!.meta);
  if (!changed) return;
  const problem = { ...fresh, tests };
  const activeFile = cur.activeFile && buffers[cur.activeFile] ? cur.activeFile : fresh.meta.mainFile;
  set({ problem, buffers, activeFile });
  events.emit("problem:reloaded", { problem });
}

/** Replace the open problem with a fresh copy from the server, keeping unsaved edits. */
function applyProblem(problem: Problem) {
  const old = get().buffers;
  const buffers = Object.fromEntries(
    problem.files.map((f) => {
      const prev = old[f.name];
      return [f.name, prev && prev.content !== prev.saved ? { content: prev.content, saved: f.content } : { content: f.content, saved: f.content }];
    }),
  );
  set({ problem, buffers });
}

export const workspaceApi: WorkspaceApi = {
  ...workspace,
  get,
  use: (selector) => useWorkspace(selector),
  subscribe: (listener) => toDisposable(useWorkspace.subscribe(listener)),
};

/** Reopen whatever was open last session. */
export async function restoreLastProblem() {
  const id = localStorage.getItem(LAST_PROBLEM_KEY);
  if (!id) return;
  await workspace.openProblem(id).catch(() => localStorage.removeItem(LAST_PROBLEM_KEY));
}

// Don't lose edits when the tab closes.
window.addEventListener("beforeunload", (e) => {
  const dirty = Object.values(get().buffers).some((b) => b.content !== b.saved);
  if (testsTimer) void flushTests();
  if (dirty) {
    void workspace.saveAll();
    e.preventDefault();
  }
});
