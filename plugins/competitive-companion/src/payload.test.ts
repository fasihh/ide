import { test } from "node:test";
import assert from "node:assert/strict";
import { companionPayloadSchema, contestOf, platformOf, sameTest, toCreateInput } from "./payload.ts";

/** Trimmed from a real Competitive Companion request for a Codeforces problem. */
const codeforces = companionPayloadSchema.parse({
  name: "A. Watermelon",
  group: "Codeforces - Codeforces Beta Round 4 (Div. 2 Only)",
  url: "https://codeforces.com/problemset/problem/4/A",
  interactive: false,
  memoryLimit: 64,
  timeLimit: 1000,
  tests: [{ input: "8\n", output: "YES\n" }],
  testType: "single",
  input: { type: "stdin" },
  output: { type: "stdout" },
  languages: { java: { mainClass: "Main", taskClass: "AWatermelon" } },
  batch: { id: "0d0e6d1f-2a46-4d62-9a52-3d2a0c3a42c1", size: 1 },
});

test("maps a Competitive Companion payload to a new problem", () => {
  assert.deepEqual(toCreateInput(codeforces, "cpp"), {
    name: "A. Watermelon",
    platform: "codeforces",
    group: "Codeforces Beta Round 4 (Div. 2 Only)",
    url: "https://codeforces.com/problemset/problem/4/A",
    language: "cpp",
    timeLimitMs: 1000,
    memoryLimitMb: 64,
    tests: [{ input: "8\n", expected: "YES\n" }],
  });
});

test("platform from the host, else the group's site, else custom; contest from the group", () => {
  assert.equal(platformOf({ url: "https://cses.fi/problemset/task/1068", group: "CSES - CSES Problem Set" }), "cses");
  assert.equal(platformOf({ url: "https://atcoder.jp/contests/abc300/tasks/abc300_a", group: "AtCoder - ABC 300" }), "atcoder");
  assert.equal(platformOf({ url: "https://m1.codeforces.com/contest/1/problem/A", group: "" }), "codeforces");
  assert.equal(platformOf({ url: "https://www.luogu.com.cn/problem/P1001", group: "Luogu - Problems" }), "luogu");
  assert.equal(platformOf({ url: "", group: "" }), "custom");
  assert.equal(contestOf("CSES - CSES Problem Set"), "CSES Problem Set");
  assert.equal(contestOf("Local"), "Local");
  assert.equal(contestOf(""), "misc");
});

test("sparse payloads get defaults", () => {
  const p = companionPayloadSchema.parse({ name: "Sum" });
  assert.deepEqual(toCreateInput(p, "python"), { name: "Sum", platform: "custom", group: "misc", url: undefined, language: "python", timeLimitMs: undefined, memoryLimitMb: undefined, tests: [] });
});

test("tests compare without trailing whitespace or CRLF differences", () => {
  assert.ok(sameTest({ input: "1 2\r\n", expected: "3 \n" }, { input: "1 2", expected: "3" }));
  assert.ok(!sameTest({ input: "1 2", expected: "3" }, { input: "1 2", expected: "4" }));
});
