import type { CompareMode, DiffInfo } from "./domain.ts";

type Token = { text: string; line: number };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const t of lines[i]!.split(/\s+/)) if (t) out.push({ text: t, line: i + 1 });
  }
  return out;
}

function normalizeLines(s: string): string[] {
  const lines = s.split(/\r?\n/).map((l) => l.trimEnd());
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function floatEqual(a: string, b: string, eps: number): boolean {
  if (a === b) return true;
  if (!NUMBER.test(a) || !NUMBER.test(b)) return false;
  const x = Number(a);
  const y = Number(b);
  const diff = Math.abs(x - y);
  return diff <= eps || diff <= eps * Math.abs(y);
}

/** Returns `null` when outputs match, otherwise where they first differ. */
export function compareOutput(
  expected: string,
  actual: string,
  mode: CompareMode,
  eps = 1e-6,
): DiffInfo | null {
  if (mode === "exact") {
    const e = normalizeLines(expected);
    const a = normalizeLines(actual);
    const n = Math.max(e.length, a.length);
    for (let i = 0; i < n; i++) {
      if (e[i] !== a[i]) {
        return {
          expectedLine: i < e.length ? i + 1 : null,
          actualLine: i < a.length ? i + 1 : null,
          expectedToken: e[i] ?? null,
          actualToken: a[i] ?? null,
        };
      }
    }
    return null;
  }

  const e = tokenize(expected);
  const a = tokenize(actual);
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i++) {
    const et = e[i];
    const at = a[i];
    const same =
      et && at && (mode === "float" ? floatEqual(et.text, at.text, eps) : et.text === at.text);
    if (!same) {
      return {
        expectedLine: et?.line ?? null,
        actualLine: at?.line ?? null,
        expectedToken: et?.text ?? null,
        actualToken: at?.text ?? null,
      };
    }
  }
  return null;
}
