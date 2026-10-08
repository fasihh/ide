import type { Position, TextEdit } from "vscode-languageserver-protocol";

/** Offset of an LSP position (0-based line, UTF-16 character — the same units as JS strings). */
function offsetAt(text: string, lineStarts: number[], p: Position): number {
  if (p.line >= lineStarts.length) return text.length;
  const start = lineStarts[p.line]!;
  // End of the line's content: before its "\n" (and a preceding "\r"), or the end of the text.
  let end = p.line + 1 < lineStarts.length ? lineStarts[p.line + 1]! - 1 : text.length;
  if (end > start && text[end - 1] === "\r") end--;
  // A character past the end of the line clamps to that end.
  return Math.min(start + p.character, end);
}

/**
 * Apply edits computed by a server against `text` (e.g. a formatting result). Per the LSP spec, all
 * ranges refer to the original text and do not overlap.
 */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const resolved = edits
    .map((e, index) => ({ start: offsetAt(text, lineStarts, e.range.start), end: offsetAt(text, lineStarts, e.range.end), newText: e.newText, index }))
    // Apply from the end so earlier offsets stay valid; equal starts keep their given order.
    .sort((a, b) => b.start - a.start || b.index - a.index);
  let out = text;
  for (const e of resolved) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  return out;
}
