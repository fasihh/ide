/**
 * Subsequence fuzzy match. Returns null when `query` isn't a subsequence of `text`, otherwise a
 * score (higher is better) and the matched character indices for highlighting.
 * Rewards consecutive runs, word starts and early matches.
 */
export function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s/:._\-()]/.test(t[found - 1]!) || (text[found] !== t[found] && text[found - 1] === t[found - 1]);
    score += 1;
    if (found === prev + 1) score += 4;
    if (wordStart) score += 3;
    score -= Math.min(found - ti, 6) * 0.2;
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  if (t.startsWith(q)) score += 5;
  return { score, indices };
}
