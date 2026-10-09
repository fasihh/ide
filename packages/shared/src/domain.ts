import { z } from "zod";

export const languageSchema = z.enum(["cpp", "python"]);
export type Language = z.infer<typeof languageSchema>;

export const LANGUAGE_INFO: Record<Language, { label: string; ext: string; monaco: string }> = {
  cpp: { label: "C++", ext: "cpp", monaco: "cpp" },
  python: { label: "Python", ext: "py", monaco: "python" },
};

export const compareModeSchema = z.enum(["token", "exact", "float"]);
export type CompareMode = z.infer<typeof compareModeSchema>;

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
  /** Interactive problem: tests run the solution against `interactor` (a file in the problem folder). */
  interactive: z.boolean().optional(),
  interactor: z.string().optional(),
  /** "playground": Run executes the main file in the terminal (live input) instead of the tests. */
  runMode: z.enum(["tests", "playground"]).optional(),
  /** Overrides `runner.compareMode` / `runner.floatEpsilon` for this problem. */
  compareMode: compareModeSchema.optional(),
  floatEpsilon: z.number().nonnegative().optional(),
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
  /** Template file name from the template library (default: the language's default template). */
  template: z.string().optional(),
  runMode: z.enum(["tests", "playground"]).optional(),
});
export type CreateProblemInput = z.input<typeof createProblemSchema>;

export const problemMetaPatchSchema = problemMetaSchema
  .pick({
    name: true,
    url: true,
    timeLimitMs: true,
    memoryLimitMb: true,
    status: true,
    tags: true,
    notes: true,
    language: true,
    compareMode: true,
    floatEpsilon: true,
    interactive: true,
    interactor: true,
    runMode: true,
  })
  .partial();
export type ProblemMetaPatch = z.infer<typeof problemMetaPatchSchema>;

// ---------- running ----------

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

/** One chunk of an interactive run's conversation, in order. */
export type TranscriptEntry = { from: "solution" | "interactor"; text: string };

export type ExecResult = {
  verdict: Verdict;
  timeMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Human readable explanation for RE/TLE/OLE (e.g. "Stack overflow"). */
  message?: string;
  diff?: DiffInfo;
  /** Interactive runs: what each side wrote to the other (capped). */
  transcript?: TranscriptEntry[];
  transcriptTruncated?: boolean;
  /** Interactive runs: the interactor's stderr (its verdict message). */
  interactorStderr?: string;
};

export const execRequestSchema = z.object({
  artifactId: z.string(),
  input: z.string(),
  /** Omit or leave blank to skip comparison (verdict RAN). */
  expected: z.string().optional(),
  timeLimitMs: z.number().int().positive().optional(),
  compareMode: compareModeSchema.optional(),
  floatEpsilon: z.number().nonnegative().optional(),
});
export type ExecRequest = z.infer<typeof execRequestSchema>;

/**
 * Run a solution against an interactor. The interactor is started testlib-style as
 * `interactor <input-file> <output-file> <answer-file>`: `input` and `expected` are written to the
 * input/answer files, its stdin/stdout are wired to the solution's stdout/stdin, and its exit code
 * is the verdict (0 = AC, 1 = WA, 2 = presentation error, 3 = interactor failure).
 */
export const interactRequestSchema = z.object({
  artifactId: z.string(),
  interactorArtifactId: z.string(),
  input: z.string(),
  expected: z.string().optional(),
  timeLimitMs: z.number().int().positive().optional(),
});
export type InteractRequest = z.infer<typeof interactRequestSchema>;

export const compileRequestSchema = z.object({
  language: languageSchema,
  source: z.string(),
  /** Shown in place of the temp file path in compiler diagnostics. */
  fileName: z.string().optional(),
});
export type CompileRequest = z.infer<typeof compileRequestSchema>;

// ---------- library (templates & snippets) ----------

export const libraryKindSchema = z.enum(["templates", "snippets"]);
export type LibraryKind = z.infer<typeof libraryKindSchema>;
/** File name of a template/snippet, e.g. `main.cpp`, `dsu.cpp`, `fast_io.py`. */
export const libraryNameSchema = z.string().regex(/^[\w.-]+\.(cpp|py)$/, "Use a name like dsu.cpp or fast_io.py");
export type LibraryItem = { name: string; language: Language; content: string };

// ---------- server → web events (SSE at /api/events) ----------

export type ServerEvent =
  /** Files under the problems root changed (by the app or externally). `ids` are affected problem ids. */
  | { type: "problems-changed"; ids: string[] }
  /** Plugins were turned on or off; the server has finished (de)activating its halves. */
  | { type: "plugins-changed" }
  /** A server plugin's message for its web half. */
  | { type: "plugin"; pluginId: string; payload: unknown };
