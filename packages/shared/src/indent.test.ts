import { test } from "node:test";
import assert from "node:assert/strict";
import { reindent } from "./indent.ts";

const four = { tabSize: 4, insertSpaces: true };
const two = { tabSize: 2, insertSpaces: true };
const tabs = { tabSize: 4, insertSpaces: false };

test("4 spaces to 2 spaces per level, nested", () => {
  const src = "int main() {\n    if (x) {\n        return 0;\n    }\n}\n";
  assert.equal(reindent(src, four, two), "int main() {\n  if (x) {\n    return 0;\n  }\n}\n");
});

test("spaces to tabs and back; tabs count as one level", () => {
  const src = "a\n    b\n        c\n";
  assert.equal(reindent(src, four, tabs), "a\n\tb\n\t\tc\n");
  assert.equal(reindent("a\n\tb\n\t\tc\n", tabs, two), "a\n  b\n    c\n");
});

test("alignment spaces that are not a whole level are kept; other text untouched", () => {
  // 6 columns = 1 level (4) + 2 alignment spaces → 1 level (2) + 2 spaces.
  assert.equal(reindent("      x = 1;  // a\n", four, two), "    x = 1;  // a\n");
  // 2 spaces + a tab reach column 4 (1 level), 2 more spaces make 6: same result.
  assert.equal(reindent("  \t  y\n", four, two), "    y\n");
  assert.equal(reindent("no indent\r\n    crlf\r\n", four, two), "no indent\r\n  crlf\r\n");
});
