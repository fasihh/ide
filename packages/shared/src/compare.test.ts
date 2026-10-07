import { test } from "node:test";
import assert from "node:assert/strict";
import { compareOutput } from "./compare.ts";

test("token mode ignores whitespace layout", () => {
  assert.equal(compareOutput("1 2\n3\n", "1\n2 3", "token"), null);
  assert.equal(compareOutput("YES\r\n", "YES", "token"), null);
});

test("token mode reports first mismatch with lines", () => {
  assert.deepEqual(compareOutput("1\n2\n3", "1\n2\n4", "token"), {
    expectedLine: 3,
    actualLine: 3,
    expectedToken: "3",
    actualToken: "4",
  });
});

test("token mode detects missing and extra output", () => {
  assert.deepEqual(compareOutput("1 2", "1", "token"), {
    expectedLine: 1,
    actualLine: null,
    expectedToken: "2",
    actualToken: null,
  });
  assert.equal(compareOutput("1", "1 2", "token")?.actualToken, "2");
});

test("float mode allows absolute and relative error", () => {
  assert.equal(compareOutput("0.3333333", "0.33333331", "float", 1e-6), null);
  assert.equal(compareOutput("1000000000", "1000000500", "float", 1e-6), null);
  assert.notEqual(compareOutput("0.5", "0.6", "float", 1e-6), null);
  assert.notEqual(compareOutput("abc", "abd", "float", 1e-6), null);
});

test("exact mode ignores trailing whitespace only", () => {
  assert.equal(compareOutput("a b \n\n", "a b", "exact"), null);
  assert.equal(compareOutput("a  b", "a b", "exact")?.expectedLine, 1);
});
