import { z } from "zod";

export const languageSchema = z.enum(["cpp", "python"]);
export type Language = z.infer<typeof languageSchema>;

export const LANGUAGE_INFO: Record<Language, { label: string; ext: string; monaco: string }> = {
  cpp: { label: "C++", ext: "cpp", monaco: "cpp" },
  python: { label: "Python", ext: "py", monaco: "python" },
};

export const problemStatusSchema = z.enum(["todo", "attempted", "solved"]);
export type ProblemStatus = z.infer<typeof problemStatusSchema>;

/** Contents of `problem.json` inside a problem folder. */
export const problemMetaSchema = z.object({
  name: z.string(),
  platform: z.string(),
  group: z.string(),
  url: z.string().optional(),
  language: languageSchema,
  mainFile: z.string(),
  /** Overrides `runner.timeLimitMs` when set. */
  timeLimitMs: z.number().int().positive().optional(),
  memoryLimitMb: z.number().int().positive().optional(),
  interactive: z.boolean().optional(),
  status: problemStatusSchema,
  tags: z.array(z.string()),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProblemMeta = z.infer<typeof problemMetaSchema>;

/** A problem as listed in the index. `id` is the folder path relative to the problems root (posix separators). */
export type ProblemSummary = ProblemMeta & { id: string };

export const testCaseSchema = z.object({
  id: z.string(),
  input: z.string(),
  expected: z.string(),
  isSample: z.boolean(),
  enabled: z.boolean(),
});
export type TestCase = z.infer<typeof testCaseSchema>;

export type ProblemFile = { name: string; content: string };

export type Problem = {
  id: string;
  meta: ProblemMeta;
  tests: TestCase[];
  files: ProblemFile[];
};

export const createProblemSchema = z.object({
  name: z.string().min(1),
  platform: z.string().min(1).default("custom"),
  group: z.string().min(1).default("misc"),
  url: z.string().optional(),
  language: languageSchema.optional(),
  timeLimitMs: z.number().int().positive().optional(),
  memoryLimitMb: z.number().int().positive().optional(),
  tests: z.array(z.object({ input: z.string(), expected: z.string() })).optional(),
});
export type CreateProblemInput = z.input<typeof createProblemSchema>;

export const problemMetaPatchSchema = problemMetaSchema
  .pick({ name: true, url: true, timeLimitMs: true, memoryLimitMb: true, status: true, tags: true, notes: true, language: true })
  .partial();
export type ProblemMetaPatch = z.infer<typeof problemMetaPatchSchema>;

// ---------- running ----------

export const compareModeSchema = z.enum(["token", "exact", "float"]);
export type CompareMode = z.infer<typeof compareModeSchema>;

/**
 * - AC/WA: compared against expected output
 * - RAN: ran fine but there was no expected output to compare against
 * - TLE/RE/OLE: runtime failures
 * - CE: compilation failed (applied to every test of a run)
 */
export type Verdict = "AC" | "WA" | "RAN" | "TLE" | "RE" | "OLE" | "CE";

export type CompileResult =
  | { ok: true; artifactId: string; cached: boolean; timeMs: number; stderr: string }
  | { ok: false; timeMs: number; stderr: string };

export type DiffInfo = {
  /** 1-based line of the first mismatch in the expected output (null when expected ran out). */
  expectedLine: number | null;
  /** 1-based line of the first mismatch in the received output (null when output ran out). */
  actualLine: number | null;
  expectedToken: string | null;
  actualToken: string | null;
};

export type ExecResult = {
  verdict: Verdict;
  timeMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Human readable explanation for RE/TLE/OLE (e.g. "Stack overflow"). */
  message?: string;
  diff?: DiffInfo;
};

export const execRequestSchema = z.object({
  artifactId: z.string(),
  input: z.string(),
  /** Omit or leave blank to skip comparison (verdict RAN). */
  expected: z.string().optional(),
  timeLimitMs: z.number().int().positive().optional(),
  compareMode: compareModeSchema.optional(),
});
export type ExecRequest = z.infer<typeof execRequestSchema>;

export const compileRequestSchema = z.object({
  language: languageSchema,
  source: z.string(),
  /** Shown in place of the temp file path in compiler diagnostics. */
  fileName: z.string().optional(),
});
export type CompileRequest = z.infer<typeof compileRequestSchema>;
