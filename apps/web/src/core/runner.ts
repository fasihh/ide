import { create } from "zustand";
import type { RunnerApi, RunnerState, TestRunState } from "@cp-ide/plugin-api/web";
import { toDisposable } from "@cp-ide/plugin-api/web";
import type { CompileResult, ExecResult } from "@cp-ide/shared";
import { api, unwrap } from "../api.ts";
import { events } from "./registry.ts";
import { getSetting } from "./settings.ts";
import { useWorkspace, workspace } from "./workspace.ts";
import { reportError } from "./notify.ts";

export const useRunner = create<RunnerState>(() => ({ phase: "idle", compile: null, tests: {}, custom: { status: "idle" } }));

const set = useRunner.setState;
let runId = 0;

function setTest(id: string, state: TestRunState) {
  set((s) => ({ tests: { ...s.tests, [id]: state } }));
}

// A different problem means old results are meaningless.
events.on("problem:opened", () => {
  runId++;
  set({ phase: "idle", compile: null, tests: {}, custom: { status: "idle" } });
});

async function compile(): Promise<CompileResult> {
  const { problem, buffers } = useWorkspace.getState();
  if (!problem) throw new Error("No problem is open");
  const file = problem.meta.mainFile;
  const source = buffers[file]?.content ?? "";
  const result = await unwrap(api.run.compile.$post({ json: { language: problem.meta.language, source, fileName: file } }));
  set({ compile: result });
  events.emit("run:compiled", { result });
  return result;
}

async function run(testIds?: string[]) {
  const { problem } = useWorkspace.getState();
  if (!problem) return;
  const id = ++runId;
  const tests = testIds ? problem.tests.filter((t) => testIds.includes(t.id)) : problem.tests.filter((t) => t.enabled);
  const ids = tests.map((t) => t.id);

  void workspace.saveAll().catch(reportError("Save failed"));
  set((s) => ({ phase: "compiling", tests: { ...s.tests, ...Object.fromEntries(ids.map((i) => [i, { status: "queued" } as const])) } }));
  events.emit("run:started", { testIds: ids });

  let compiled: CompileResult;
  try {
    compiled = await compile();
  } catch (err) {
    if (id === runId) set((s) => ({ phase: "idle", tests: { ...s.tests, ...Object.fromEntries(ids.map((i) => [i, { status: "idle" } as const])) } }));
    reportError("Compile request failed")(err);
    return;
  }
  if (id !== runId) return;

  const results: Record<string, ExecResult> = {};
  if (!compiled.ok) {
    const ce: ExecResult = { verdict: "CE", timeMs: 0, exitCode: null, stdout: "", stderr: "", message: "Compilation failed" };
    for (const i of ids) {
      results[i] = ce;
      setTest(i, { status: "done", result: ce });
    }
    set({ phase: "idle" });
    events.emit("run:finished", { results });
    return;
  }

  set({ phase: "running" });
  const timeLimitMs = problem.meta.timeLimitMs ?? getSetting("runner.timeLimitMs");
  const queue = [...tests];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      if (id !== runId) return;
      setTest(t.id, { status: "running" });
      let result: ExecResult;
      try {
        result = await unwrap(
          api.run.exec.$post({ json: { artifactId: compiled.artifactId, input: t.input, expected: t.expected, timeLimitMs } }),
        );
      } catch (err) {
        result = { verdict: "RE", timeMs: 0, exitCode: null, stdout: "", stderr: "", message: err instanceof Error ? err.message : String(err) };
      }
      if (id !== runId) return;
      results[t.id] = result;
      setTest(t.id, { status: "done", result });
      events.emit("run:test-finished", { testId: t.id, result });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, getSetting("runner.maxConcurrency")) }, worker));
  if (id !== runId) return;
  set({ phase: "idle" });
  events.emit("run:finished", { results });
}

async function runCustom(input: string): Promise<ExecResult | undefined> {
  const { problem } = useWorkspace.getState();
  if (!problem) return undefined;
  set({ custom: { status: "running" } });
  try {
    const compiled = await compile();
    const result: ExecResult = compiled.ok
      ? await unwrap(
          api.run.exec.$post({
            json: { artifactId: compiled.artifactId, input, timeLimitMs: problem.meta.timeLimitMs ?? getSetting("runner.timeLimitMs") },
          }),
        )
      : { verdict: "CE", timeMs: 0, exitCode: null, stdout: "", stderr: "", message: "Compilation failed" };
    set({ custom: { status: "done", result } });
    return result;
  } catch (err) {
    set({ custom: { status: "idle" } });
    reportError("Run failed")(err);
    return undefined;
  }
}

export const runnerApi: RunnerApi = {
  get: useRunner.getState,
  use: (selector) => useRunner(selector),
  subscribe: (listener) => toDisposable(useRunner.subscribe(listener)),
  compile,
  run,
  runCustom,
  exec: (req) => unwrap(api.run.exec.$post({ json: req })),
};
