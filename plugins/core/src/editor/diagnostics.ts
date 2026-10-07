export type Diagnostic = {
  line: number;
  column: number;
  severity: "error" | "warning" | "note";
  message: string;
};

const GCC = /^(?<file>[^\n:]+):(?<line>\d+):(?<col>\d+): (?<sev>fatal error|error|warning|note): (?<msg>.*)$/;
const PY_LOC = /^\s*File "(?<file>[^"]+)", line (?<line>\d+)/;

/** Parse g++ diagnostics or a Python traceback / syntax error for `fileName`. */
export function parseDiagnostics(text: string, fileName: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lines = text.split(/\r?\n/);
  for (const l of lines) {
    const m = GCC.exec(l);
    if (m?.groups && m.groups.file === fileName) {
      const sev = m.groups.sev!;
      out.push({
        line: Number(m.groups.line),
        column: Number(m.groups.col),
        severity: sev.includes("error") ? "error" : sev === "warning" ? "warning" : "note",
        message: m.groups.msg!,
      });
    }
  }
  if (out.length) return out;

  // Python: the last `File "main.py", line N` frame plus the final "XError: msg" line.
  let pyLine: number | null = null;
  for (const l of lines) {
    const m = PY_LOC.exec(l);
    if (m?.groups?.file === fileName) pyLine = Number(m.groups.line);
  }
  const last = lines.filter((l) => l.trim()).at(-1);
  if (pyLine !== null && last) out.push({ line: pyLine, column: 1, severity: "error", message: last.trim() });
  return out;
}

/** Split text into segments, marking `file:line:col` / `File "file", line N` references. */
export function linkify(text: string, fileName: string): ({ text: string } | { text: string; line: number; column: number })[] {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}:(\\d+):(\\d+)|File "${escaped}", line (\\d+)`, "g");
  const out: ({ text: string } | { text: string; line: number; column: number })[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], line: Number(m[1] ?? m[3]), column: Number(m[2] ?? 1) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
