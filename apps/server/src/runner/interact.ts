import { spawn } from "node:child_process";
import type { TranscriptEntry } from "@cp-ide/shared";

export type CommandLine = { command: string; args: string[] };

export type InteractOutcome = {
  timeMs: number;
  timedOut: boolean;
  outputExceeded: boolean;
  solution: { exitCode: number | null; signal: string | null; stderr: string; spawnError?: string };
  interactor: { exitCode: number | null; signal: string | null; stderr: string; spawnError?: string };
  transcript: TranscriptEntry[];
  transcriptTruncated: boolean;
};

const TRANSCRIPT_LIMIT = 256 * 1024;
const STDERR_LIMIT = 64 * 1024;
/** After the interactor finishes, how long the solution may take to exit on its own. */
const GRACE_MS = 1000;

/**
 * Run `solution` and `interactor` with their stdout/stdin cross-connected. Everything that
 * crosses is also recorded (merged per direction) for the transcript.
 */
export function runInteractive(
  solution: CommandLine,
  interactor: CommandLine,
  opts: { timeoutMs: number; outputLimit: number; cwd: string; env: NodeJS.ProcessEnv },
): Promise<InteractOutcome> {
  return new Promise((resolve) => {
    const started = performance.now();
    const transcript: TranscriptEntry[] = [];
    let transcriptBytes = 0;
    let transcriptTruncated = false;
    let crossed = 0;
    let timedOut = false;
    let outputExceeded = false;
    let solEnd = 0;

    const record = (from: TranscriptEntry["from"], chunk: Buffer) => {
      if (transcriptTruncated) return;
      if (transcriptBytes + chunk.length > TRANSCRIPT_LIMIT) {
        transcriptTruncated = true;
        return;
      }
      transcriptBytes += chunk.length;
      const text = chunk.toString("utf8");
      const last = transcript[transcript.length - 1];
      if (last?.from === from) last.text += text;
      else transcript.push({ from, text });
    };

    const spawnOpts = { cwd: opts.cwd, windowsHide: true, env: opts.env };
    const sol = spawn(solution.command, solution.args, spawnOpts);
    const int = spawn(interactor.command, interactor.args, spawnOpts);

    const state = {
      solution: { exitCode: null as number | null, signal: null as string | null, stderr: "", spawnError: undefined as string | undefined, done: false },
      interactor: { exitCode: null as number | null, signal: null as string | null, stderr: "", spawnError: undefined as string | undefined, done: false },
    };

    const killAll = () => {
      sol.kill("SIGKILL");
      int.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killAll();
    }, opts.timeoutMs);
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    // Writing to a process that already exited raises EPIPE — expected here.
    sol.stdin.on("error", () => {});
    int.stdin.on("error", () => {});

    sol.stdout.on("data", (b: Buffer) => {
      crossed += b.length;
      if (crossed > opts.outputLimit) {
        outputExceeded = true;
        killAll();
        return;
      }
      record("solution", b);
      if (!state.interactor.done) int.stdin.write(b);
    });
    int.stdout.on("data", (b: Buffer) => {
      record("interactor", b);
      if (!state.solution.done) sol.stdin.write(b);
    });
    sol.stderr.on("data", (b: Buffer) => {
      if (state.solution.stderr.length < STDERR_LIMIT) state.solution.stderr += b.toString("utf8");
    });
    int.stderr.on("data", (b: Buffer) => {
      if (state.interactor.stderr.length < STDERR_LIMIT) state.interactor.stderr += b.toString("utf8");
    });
    sol.on("error", (e) => {
      state.solution.spawnError = e.message;
    });
    int.on("error", (e) => {
      state.interactor.spawnError = e.message;
    });

    const finish = () => {
      if (!state.solution.done || !state.interactor.done) return;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      const { done: _a, ...solution } = state.solution;
      const { done: _b, ...interactor } = state.interactor;
      resolve({
        timeMs: Math.round((solEnd || performance.now()) - started),
        timedOut,
        outputExceeded,
        solution,
        interactor,
        transcript,
        transcriptTruncated,
      });
    };

    sol.on("close", (code, signal) => {
      state.solution = { ...state.solution, exitCode: code, signal, done: true };
      solEnd = performance.now();
      // The solution is gone: the interactor sees EOF and should finish.
      int.stdin.end();
      finish();
    });
    int.on("close", (code, signal) => {
      state.interactor = { ...state.interactor, exitCode: code, signal, done: true };
      sol.stdin.end();
      // The judge has decided; a solution still waiting for input gets a moment to exit.
      if (!state.solution.done) graceTimer = setTimeout(() => sol.kill("SIGKILL"), GRACE_MS);
      finish();
    });
  });
}
