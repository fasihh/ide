import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompletionList } from "vscode-languageserver-protocol";
import { memberCompletionKeys, rebaseCompletion, withoutEditRanges } from "./completion.ts";

const key = (receiver: string, typed: string) => ["f", receiver, typed].join("\n");

test("member-access keys: exact first, then shorter prefixes; other completions are not keyed", () => {
  const exact = (prefix: string) => memberCompletionKeys("f", prefix)?.[0];
  assert.equal(exact("    x = np."), key("np.", ""));
  assert.deepEqual(memberCompletionKeys("f", "np.ze"), [key("np.", "ze"), key("np.", "z"), key("np.", "")]);
  assert.equal(exact("print(self.grid.ro"), key("self.grid.", "ro"));
  assert.equal(exact("  v."), key("v.", ""));
  assert.equal(exact("it->sec"), key("it->", "sec"));
  assert.equal(exact("std::vec"), key("std::", "vec"));
  assert.equal(memberCompletionKeys("f", "    pri"), null);
  assert.equal(memberCompletionKeys("f", "x = 1."), null, "a number is not a receiver");
});

test("rebase shifts edits on the request line and leaves others", () => {
  const list: CompletionList = {
    isIncomplete: true,
    items: [
      {
        label: "push_back",
        textEdit: { range: { start: { line: 3, character: 6 }, end: { line: 3, character: 8 } }, newText: "push_back(${1})" },
        additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "#include <vector>\n" }],
      },
      { label: "size" },
    ],
  };
  const moved = rebaseCompletion(list, { line: 3, character: 8 }, { line: 10, character: 12 }) as CompletionList;
  assert.deepEqual(moved.items[0]!.textEdit, { range: { start: { line: 10, character: 10 }, end: { line: 10, character: 12 } }, newText: "push_back(${1})" });
  assert.deepEqual(moved.items[0]!.additionalTextEdits, list.items[0]!.additionalTextEdits);
  assert.equal(moved.isIncomplete, true);
  assert.equal((list.items[0]!.textEdit as { range: { start: { line: number } } }).range.start.line, 3, "the cached input is untouched");
});

test("a superset list keeps item text but drops edit ranges", () => {
  const list = [{ label: "zeros", textEdit: { range: { start: { line: 1, character: 3 }, end: { line: 1, character: 3 } }, newText: "zeros" } }, { label: "abs" }];
  assert.deepEqual(withoutEditRanges(list), [{ label: "zeros", insertText: "zeros" }, { label: "abs" }]);
});
