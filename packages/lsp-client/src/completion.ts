import type { CompletionItem, CompletionList, Position, Range, TextEdit, InsertReplaceEdit } from "vscode-languageserver-protocol";

export type CompletionResult = CompletionList | CompletionItem[];

/**
 * An expression ending in a member/scope operator (`np.`, `self.grid.`, `v.`, `ptr->`, `std::`),
 * followed by the identifier typed so far.
 */
const MEMBER_ACCESS = /([A-Za-z_$][\w$]*(?:(?:\.|->|::)[A-Za-z_$][\w$]*)*(?:\.|->|::))([\w$]*)$/;

/**
 * Cache keys for a member-access completion, from the line text before the cursor: the document, the
 * receiver expression and the typed prefix — the exact key first, then the same receiver with shorter
 * prefixes (`np.ze`, `np.z`, `np.`), whose lists are supersets usable while the exact one loads.
 * Other completions (local names, keywords) depend on the surrounding scope and are not keyed — `null`.
 */
export function memberCompletionKeys(uri: string, linePrefix: string): string[] | null {
  const match = MEMBER_ACCESS.exec(linePrefix);
  if (!match) return null;
  const [, receiver, typed] = match as unknown as [string, string, string];
  return Array.from({ length: typed.length + 1 }, (_, i) => `${uri}\n${receiver}\n${typed.slice(0, typed.length - i)}`);
}

/**
 * A result computed for a shorter typed prefix, reused while the exact one loads: edit ranges no longer
 * match the typed word, so each item keeps only its text and the editor replaces the current word.
 */
export function withoutEditRanges(result: CompletionResult): CompletionResult {
  const items = (Array.isArray(result) ? result : result.items).map(({ textEdit, ...item }) => (textEdit ? { ...item, insertText: textEdit.newText } : item));
  return Array.isArray(result) ? items : { ...result, items };
}

/**
 * Move a completion result computed at `from` to `to`. Valid when the text before both positions is
 * the same (same cache key): edits on the request line shift with the cursor; edits elsewhere (e.g. an
 * `#include` added at the top) stay where they are. The input is not modified.
 */
export function rebaseCompletion(result: CompletionResult, from: Position, to: Position): CompletionResult {
  if (from.line === to.line && from.character === to.character) return result;
  const shift = (p: Position): Position =>
    p.line === from.line ? { line: to.line, character: p.character + to.character - from.character } : p;
  const shiftRange = (r: Range): Range => ({ start: shift(r.start), end: shift(r.end) });
  const shiftEdit = (e: TextEdit | InsertReplaceEdit): TextEdit | InsertReplaceEdit =>
    "range" in e ? { ...e, range: shiftRange(e.range) } : { ...e, insert: shiftRange(e.insert), replace: shiftRange(e.replace) };
  const items = (Array.isArray(result) ? result : result.items).map((item) => (item.textEdit ? { ...item, textEdit: shiftEdit(item.textEdit) } : item));
  return Array.isArray(result) ? items : { ...result, items };
}
