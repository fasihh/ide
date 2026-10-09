export type IndentStyle = { tabSize: number; insertSpaces: boolean };

/**
 * Re-indent text from one indentation style to another: each line's leading whitespace is measured in
 * levels of `from` (a tab counts as one level, `from.tabSize` spaces as one level) and rewritten in `to`.
 * Leftover spaces that do not make a whole level (alignment) are kept. Only leading whitespace changes.
 */
export function reindent(text: string, from: IndentStyle, to: IndentStyle): string {
  const unit = to.insertSpaces ? " ".repeat(to.tabSize) : "\t";
  return text.replace(/^[ \t]+/gm, (lead) => {
    let columns = 0;
    for (const ch of lead) columns = ch === "\t" ? (Math.floor(columns / from.tabSize) + 1) * from.tabSize : columns + 1;
    const levels = Math.floor(columns / from.tabSize);
    return unit.repeat(levels) + " ".repeat(columns % from.tabSize);
  });
}
