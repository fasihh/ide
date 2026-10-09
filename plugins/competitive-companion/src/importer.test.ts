import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProblemsService } from "@cp-ide/plugin-api/server";
import type { CreateProblemInput, Problem, ProblemMetaPatch, TestCase } from "@cp-ide/shared";
import { BatchCollector, importProblem } from "./importer.ts";
import { companionPayloadSchema } from "./payload.ts";

/** Just enough of ProblemsService, in memory. */
function fakeProblems() {
  const store = new Map<string, Problem>();
  const calls: string[] = [];
  const service = {
    list: async () => [...store.values()].map((p) => ({ ...p.meta, id: p.id })),
    get: async (id: string) => store.get(id)!,
    create: async (input: CreateProblemInput) => {
      const id = `${input.platform}/${input.group}/${input.name}`;
      const tests: TestCase[] = (input.tests ?? []).map((t, i) => ({ id: `t${i}`, ...t, isSample: true, enabled: true }));
      const meta = { name: input.name, platform: input.platform!, group: input.group!, url: input.url, language: input.language!, mainFile: "main.cpp", status: "todo", tags: [], createdAt: "", updatedAt: "" } as Problem["meta"];
      store.set(id, { id, meta, tests, files: [] });
      calls.push(`create ${id}`);
      return store.get(id)!;
    },
    writeTests: async (id: string, tests: TestCase[]) => {
      store.get(id)!.tests = tests;
      calls.push(`writeTests ${id} ${tests.length}`);
    },
    updateMeta: async (id: string, patch: ProblemMetaPatch) => {
      calls.push(`updateMeta ${id} ${JSON.stringify(patch)}`);
      return store.get(id)!.meta;
    },
  } as unknown as ProblemsService;
  return { service, store, calls };
}

const payload = (extra: object = {}) =>
  companionPayloadSchema.parse({
    name: "A. Guess",
    group: "Codeforces - Round 1",
    url: "https://codeforces.com/contest/1/problem/A",
    tests: [{ input: "1\n", output: "2\n" }],
    ...extra,
  });

test("creates the problem with its samples; interactive problems get their interactor", async () => {
  const { service, calls } = fakeProblems();
  const result = await importProblem(service, payload({ interactive: true }), "cpp");
  assert.deepEqual(result, { id: "codeforces/Round 1/A. Guess", name: "A. Guess", created: true, addedTests: 1 });
  assert.deepEqual(calls, ["create codeforces/Round 1/A. Guess", 'updateMeta codeforces/Round 1/A. Guess {"interactive":true}']);
});

test("importing the same URL again keeps the code and only adds new samples", async () => {
  const { service, store, calls } = fakeProblems();
  await importProblem(service, payload(), "cpp");
  const again = await importProblem(service, payload({ tests: [{ input: "1\r\n", output: "2" }, { input: "5\n", output: "6\n" }] }), "cpp");
  assert.deepEqual(again, { id: "codeforces/Round 1/A. Guess", name: "A. Guess", created: false, addedTests: 1 });
  assert.equal(store.size, 1);
  assert.deepEqual(store.get(again.id)!.tests.map((t) => t.input), ["1\n", "5\n"]);
  assert.equal(calls.filter((c) => c.startsWith("create")).length, 1);
  assert.deepEqual(await importProblem(service, payload(), "cpp").then((r) => r.addedTests), 0, "nothing new");
});

test("a contest is announced once, when all its problems arrived (or after a pause)", async () => {
  const flushed: string[][] = [];
  const batches = new BatchCollector<string>((items) => flushed.push(items), 30);
  batches.add("contest", 3, "A");
  batches.add("contest", 3, "B");
  assert.deepEqual(flushed, []);
  batches.add("contest", 3, "C");
  assert.deepEqual(flushed, [["A", "B", "C"]]);

  batches.add("partial", 2, "X");
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(flushed.at(-1), ["X"], "a missing problem does not hold the others back");
  batches.dispose();
});
