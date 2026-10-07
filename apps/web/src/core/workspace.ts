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

export const useWorkspace = create<WorkspaceState & { problemsRoot: string }>(() => ({
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
      const res = await unwrap(api.problems.$get());
      set({ problems: res.problems, problemsRoot: res.root });
    } finally {
      set({ problemsLoading: false });
    }
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

  async updateMeta(patch) {
    const p = get().problem;
    if (!p) return;
    const meta = await unwrap(api.problems.meta.$patch({ json: { id: p.id, patch } }));
    if (patch.language && meta.mainFile !== p.meta.mainFile) {
      // A new main file may have been created from a template — reload from disk.
      await workspace.openProblem(p.id);
    } else {
      setProblem((x) => ({ ...x, meta }));
    }
    set((s) => ({ problems: s.problems.map((x) => (x.id === p.id ? { ...meta, id: p.id } : x)) }));
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
};

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
