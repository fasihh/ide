import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSnippet, snippetPreview } from "./snippets.ts";

test("parses metadata header and strips it from the body", () => {
  const s = parseSnippet("// @description Segment tree\n// @prefix seg\nstruct S {};\n\n");
  assert.equal(s.description, "Segment tree");
  assert.equal(s.prefix, "seg");
  assert.equal(s.body, "struct S {};\n");
});

test("python comments and no metadata", () => {
  assert.equal(parseSnippet("# @description DSU\nclass DSU: pass\n").description, "DSU");
  assert.deepEqual(parseSnippet("int x;\n"), { body: "int x;\n" });
});

test("preview resolves placeholders", () => {
  assert.equal(snippetPreview("using mint = Mint<${1:998244353}>;\n$0"), "using mint = Mint<998244353>;\n");
  assert.equal(snippetPreview(String.raw`cost \$5 ${"${2}"}`), "cost $5 ");
});
