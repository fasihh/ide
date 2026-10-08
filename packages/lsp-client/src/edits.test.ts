import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTextEdits } from "./edits.ts";

const range = (sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } });

test("applies non-overlapping edits against the original text", () => {
  const text = "int main(){\nreturn 0;}\n";
  const formatted = applyTextEdits(text, [
    { range: range(0, 10, 0, 10), newText: " " },
    { range: range(1, 0, 1, 0), newText: "  " },
    { range: range(1, 9, 1, 9), newText: "\n" },
  ]);
  assert.equal(formatted, "int main() {\n  return 0;\n}\n");
});

test("CRLF text, whole-document replacement and out-of-range positions", () => {
  assert.equal(applyTextEdits("a\r\nb\r\n", [{ range: range(1, 0, 1, 99), newText: "B" }]), "a\r\nB\r\n");
  assert.equal(applyTextEdits("old\n", [{ range: range(0, 0, 99, 0), newText: "new\n" }]), "new\n");
  assert.equal(applyTextEdits("x", []), "x");
});

test("inserts at the same position keep their order", () => {
  assert.equal(applyTextEdits("ab", [{ range: range(0, 1, 0, 1), newText: "1" }, { range: range(0, 1, 0, 1), newText: "2" }]), "a12b");
});
