import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type CompileRequest,
  type CompileResult,
  type ExecRequest,
  type ExecResult,
  type InteractRequest,
  compareOutput,
  splitArgs,
} from "@cp-ide/shared";
import {
  type Disposable,
  type LaunchOptions,
  type ProcessLauncher,
  type ProcessSession,
  type Program,
  type RunnerService as RunnerApi,
  toDisposable,
} from "@cp-ide/plugin-api/server";
import { CACHE_DIR } from "../paths.ts";
import type { SettingsService } from "../services/settings.ts";
import { describeExit } from "./exit-codes.ts";
import { type CommandLine, runInteractive } from "./interact.ts";

type Artifact = { program: Program; fileName?: string };

/** How to start a program directly. */
function commandLine(program: Program): CommandLine {
  return program.language === "cpp"
    ? { command: program.executable, args: [] }
    : { command: program.interpreter, args: [...program.flags, program.script] };
}

/** The temp source file that diagnostics mention (replaced by the user's file name). */
const sourceOf = (program: Program) => (program.language === "cpp" ? program.source : program.script);

const COMPILE_TIMEOUT_MS = 60_000;
/** Output beyond this is still compared, but not sent back to the UI. */
const MAX_RETURNED_OUTPUT = 256 * 1024;
const EXE = process.platform === "win32" ? ".exe" : "";

const hash = (...parts: string[]) => createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 20);

export class RunnerService implements RunnerApi {
  private artifacts = new Map<string, Artifact>();
  private inflight = new Map<string, Promise<CompileResult>>();
  private running = 0;
  private waiters: (() => void)[] = [];
  private launchers: ProcessLauncher[] = [];

  constructor(
    private settings: SettingsService,
    private onCompiled: (req: CompileRequest, res: CompileResult) => void = () => {},
  ) {}

  async compile(req: CompileRequest): Promise<CompileResult> {
    const key = this.cacheKey(req);
    // Identical concurrent requests share one compilation.
    let p = this.inflight.get(key);
    if (!p) {
      p = this.doCompile(key, req).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    const res = await p;
    this.onCompiled(req, res);
    return res;
  }

  private cacheKey(req: CompileRequest): string {
    const s = this.settings;
    if (req.language === "cpp") {
      return `cpp-${hash(s.get("cpp.compiler"), s.get("cpp.standard"), s.get("cpp.flags"), String(s.get("cpp.stackSizeMb")), req.source)}`;
    }
    return `py-${hash(s.get("python.interpreter"), req.source)}`;
  }

  private async doCompile(key: string, req: CompileRequest): Promise<CompileResult> {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    if (req.language === "python") {
      const interpreter = this.settings.get("python.interpreter");
      const src = path.join(CACHE_DIR, `${key}.py`);
      await fs.writeFile(src, req.source);
      const check = await runProcess(interpreter, ["-m", "py_compile", src], { timeoutMs: COMPILE_TIMEOUT_MS });
      if (check.spawnError) return { ok: false, timeMs: elapsed(), stderr: `Could not start "${interpreter}": ${check.spawnError}` };
      if (check.exitCode !== 0) return { ok: false, timeMs: elapsed(), stderr: cleanPaths(check.stderr, src, req.fileName) };
      this.artifacts.set(key, { program: { language: "python", interpreter, flags: ["-X", "utf8"], script: src }, fileName: req.fileName });
      return { ok: true, artifactId: key, cached: false, timeMs: elapsed(), stderr: "" };
    }

    const exe = path.join(CACHE_DIR, `${key}${EXE}`);
    const src = path.join(CACHE_DIR, `${key}.cpp`);
    const artifact: Artifact = { program: { language: "cpp", executable: exe, source: src }, fileName: req.fileName };
    if (await fs.access(exe).then(() => true, () => false)) {
      this.artifacts.set(key, artifact);
      return { ok: true, artifactId: key, cached: true, timeMs: 0, stderr: "" };
    }

    await fs.writeFile(src, req.source);
    const compiler = this.settings.get("cpp.compiler");
    const stackMb = this.settings.get("cpp.stackSizeMb");
    const args = [
      `-std=${this.settings.get("cpp.standard")}`,
      ...splitArgs(this.settings.get("cpp.flags")),
      "-fdiagnostics-color=never",
      src,
      "-o",
      exe,
      ...(process.platform === "win32" && stackMb > 0 ? [`-Wl,--stack,${stackMb * 1024 * 1024}`] : []),
    ];
    const res = await runProcess(compiler, args, { timeoutMs: COMPILE_TIMEOUT_MS });
    const stderr = cleanPaths(res.stderr + res.stdout, src, req.fileName);
    if (res.spawnError) return { ok: false, timeMs: elapsed(), stderr: `Could not start "${compiler}": ${res.spawnError}` };
    if (res.timedOut) return { ok: false, timeMs: elapsed(), stderr: "Compilation timed out" };
    if (res.exitCode !== 0) return { ok: false, timeMs: elapsed(), stderr };
    // The first launch of a new .exe is slow on Windows (antivirus scan). Pay that cost
    // now, with empty input, instead of inside the first test's timing.
    if (process.platform === "win32") await runProcess(exe, [], { timeoutMs: 3000, cwd: CACHE_DIR });
    this.artifacts.set(key, artifact);
    return { ok: true, artifactId: key, cached: false, timeMs: elapsed(), stderr };
  }

  async exec(req: ExecRequest): Promise<ExecResult> {
    const artifact = this.artifacts.get(req.artifactId);
    if (!artifact) {
      return { verdict: "RE", timeMs: 0, exitCode: null, stdout: "", stderr: "", message: "Unknown artifact — compile again" };
    }
    await this.acquire();
    try {
      return await this.doExec(artifact, req);
    } finally {
      this.release();
    }
  }

  /**
   * Start an artifact with live I/O (terminal-style runs). Python runs unbuffered so prompts show up
   * immediately. Not counted against `runner.maxConcurrency` — these are user-driven, one at a time.
   */
  start(artifactId: string, opts: { maxRunMs?: number; outputLimit?: number } = {}): ProcessSession | null {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return null;
    const outputLimit = opts.outputLimit ?? this.settings.get("runner.outputLimitKb") * 1024;
    const src = sourceOf(artifact.program);
    const started = performance.now();
    const child = this.launch(artifact.program, {
      cwd: CACHE_DIR,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
    });
    const listeners = { out: [] as ((d: string) => void)[], err: [] as ((d: string) => void)[], exit: [] as ((i: { exitCode: number | null; timeMs: number; message?: string }) => void)[] };
    let reason: string | undefined;
    let spawnError: string | undefined;
    let bytes = 0;
    const stop = (why: string) => {
      reason ??= why;
      child.kill("SIGKILL");
    };
    const timer = opts.maxRunMs ? setTimeout(() => stop(`Stopped after ${Math.round(opts.maxRunMs! / 1000)} s (playground time limit)`), opts.maxRunMs) : undefined;
    const count = (b: Buffer) => {
      bytes += b.length;
      if (bytes > outputLimit) stop(`Stopped: output limit (${Math.round(outputLimit / 1024)} KB) exceeded`);
    };
    child.stdout.on("data", (b: Buffer) => {
      count(b);
      for (const l of listeners.out) l(b.toString("utf8"));
    });
    child.stderr.on("data", (b: Buffer) => {
      count(b);
      const text = cleanPaths(b.toString("utf8"), src, artifact.fileName);
      for (const l of listeners.err) l(text);
    });
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
      spawnError = e.message;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const timeMs = Math.round(performance.now() - started);
      const message = spawnError ? `Could not start program: ${spawnError}` : (reason ?? (code !== 0 || signal ? describeExit(code, signal) : undefined));
      for (const l of listeners.exit) l({ exitCode: code, timeMs, message });
    });
    return {
      write: (data) => {
        if (!child.stdin.destroyed) child.stdin.write(data);
      },
      end: () => child.stdin.end(),
      kill: () => stop("Stopped"),
      onStdout: (cb) => void listeners.out.push(cb),
      onStderr: (cb) => void listeners.err.push(cb),
      onExit: (cb) => void listeners.exit.push(cb),
    };
  }

  registerLauncher(launcher: ProcessLauncher): Disposable {
    this.launchers.push(launcher);
    return toDisposable(() => {
      this.launchers = this.launchers.filter((l) => l !== launcher);
    });
  }

  /** The first registered launcher that takes the program, else a direct spawn. */
  private launch(program: Program, opts: LaunchOptions) {
    for (const launcher of this.launchers) {
      const child = launcher.launch(program, opts);
      if (child) return child;
    }
    const { command, args } = commandLine(program);
    return spawn(command, args, { ...opts, windowsHide: true });
  }

  /** Run the solution against an interactor (see `InteractRequest` for the protocol). */
  async interact(req: InteractRequest): Promise<ExecResult> {
    const sol = this.artifacts.get(req.artifactId);
    const inter = this.artifacts.get(req.interactorArtifactId);
    if (!sol || !inter) {
      return { verdict: "RE", timeMs: 0, exitCode: null, stdout: "", stderr: "", message: "Unknown artifact — compile again" };
    }
    await this.acquire();
    const dir = await fs.mkdtemp(path.join(CACHE_DIR, "interact-"));
    try {
      const files = { input: path.join(dir, "input.txt"), output: path.join(dir, "output.txt"), answer: path.join(dir, "answer.txt") };
      await fs.writeFile(files.input, req.input);
      await fs.writeFile(files.answer, req.expected ?? "");
      const tl = req.timeLimitMs ?? this.settings.get("runner.timeLimitMs");
      const interCmd = commandLine(inter.program);
      const res = await runInteractive(commandLine(sol.program), { command: interCmd.command, args: [...interCmd.args, files.input, files.output, files.answer] }, {
        timeoutMs: Math.round(tl * this.settings.get("runner.killAfterFactor")),
        outputLimit: this.settings.get("runner.outputLimitKb") * 1024,
        cwd: dir,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
      });
      const interStderr = truncate(cleanPaths(res.interactor.stderr, sourceOf(inter.program), inter.fileName)).trim();
      const base = {
        timeMs: res.timeMs,
        exitCode: res.solution.exitCode,
        stdout: "",
        stderr: truncate(cleanPaths(res.solution.stderr, sourceOf(sol.program), sol.fileName)),
        transcript: res.transcript,
        transcriptTruncated: res.transcriptTruncated,
        interactorStderr: interStderr,
      };
      const judgeSays = interStderr.split(/\r?\n/)[0] || undefined;

      if (res.solution.spawnError) return { ...base, verdict: "RE", message: `Could not start program: ${res.solution.spawnError}` };
      if (res.interactor.spawnError) return { ...base, verdict: "RE", message: `Could not start interactor: ${res.interactor.spawnError}` };
      if (res.outputExceeded) return { ...base, verdict: "OLE", message: "Output limit exceeded" };
      if (res.timedOut) return { ...base, verdict: "TLE", message: `Killed after ${res.timeMs} ms (both sides stopped)` };
      const ic = res.interactor.exitCode;
      if (ic === 3) return { ...base, verdict: "RE", message: `Interactor failed (judge error)${judgeSays ? `: ${judgeSays}` : ""}` };
      if (ic === 1 || ic === 2) {
        return { ...base, verdict: "WA", message: `${ic === 2 ? "Presentation error" : "Wrong answer"}${judgeSays ? `: ${judgeSays}` : ""}` };
      }
      if (ic !== 0) {
        return { ...base, verdict: "RE", message: `Interactor crashed: ${describeExit(ic, res.interactor.signal) ?? "killed"}${judgeSays ? ` — ${judgeSays}` : ""}` };
      }
      if (res.solution.exitCode !== 0 || res.solution.signal) {
        return { ...base, verdict: "RE", message: describeExit(res.solution.exitCode, res.solution.signal) ?? "Solution did not exit after the interactor finished" };
      }
      if (res.timeMs > tl) return { ...base, verdict: "TLE", message: `Took ${res.timeMs} ms (limit ${tl} ms)` };
      return { ...base, verdict: "AC", message: judgeSays };
    } finally {
      this.release();
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async doExec(artifact: Artifact, req: ExecRequest): Promise<ExecResult> {
    const tl = req.timeLimitMs ?? this.settings.get("runner.timeLimitMs");
    const { command, args } = commandLine(artifact.program);
    const res = await runProcess(command, args, {
      input: req.input,
      timeoutMs: Math.round(tl * this.settings.get("runner.killAfterFactor")),
      outputLimit: this.settings.get("runner.outputLimitKb") * 1024,
      cwd: CACHE_DIR,
    });
    const base = {
      timeMs: res.timeMs,
      exitCode: res.exitCode,
      stdout: truncate(res.stdout),
      stderr: truncate(cleanPaths(res.stderr, sourceOf(artifact.program), artifact.fileName)),
    };

    if (res.spawnError) return { ...base, verdict: "RE", message: `Could not start program: ${res.spawnError}` };
    if (res.timedOut) return { ...base, verdict: "TLE", message: `Killed after ${res.timeMs} ms` };
    if (res.outputExceeded) return { ...base, verdict: "OLE", message: "Output limit exceeded" };
    if (res.exitCode !== 0 || res.signal) return { ...base, verdict: "RE", message: describeExit(res.exitCode, res.signal) };
    if (res.timeMs > tl) return { ...base, verdict: "TLE", message: `Took ${res.timeMs} ms (limit ${tl} ms)` };

    if (req.expected === undefined || req.expected.trim() === "") return { ...base, verdict: "RAN" };
    const diff = compareOutput(
      req.expected,
      res.stdout,
      req.compareMode ?? this.settings.get("runner.compareMode"),
      req.floatEpsilon ?? this.settings.get("runner.floatEpsilon"),
    );
    return diff ? { ...base, verdict: "WA", diff } : { ...base, verdict: "AC" };
  }

  private async acquire() {
    while (this.running >= this.settings.get("runner.maxConcurrency")) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
    this.running++;
  }

  private release() {
    this.running--;
    this.waiters.shift()?.();
  }
}

function truncate(s: string) {
  return s.length > MAX_RETURNED_OUTPUT ? `${s.slice(0, MAX_RETURNED_OUTPUT)}\n... (truncated, ${s.length} chars total)` : s;
}

/** Replace the temp source path in diagnostics with the user's file name. */
function cleanPaths(text: string, src: string, fileName = "main") {
  return text.split(src).join(fileName).split(src.replace(/\\/g, "/")).join(fileName);
}

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timeMs: number;
  timedOut: boolean;
  outputExceeded: boolean;
  spawnError?: string;
};

function runProcess(
  command: string,
  args: string[],
  opts: { input?: string; timeoutMs: number; outputLimit?: number; cwd?: string },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const limit = opts.outputLimit ?? 64 * 1024 * 1024;
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let spawnError: string | undefined;

    const started = performance.now();
    const child = spawn(command, args, {
      cwd: opts.cwd,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout.on("data", (b: Buffer) => {
      outBytes += b.length;
      if (outBytes > limit) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      out.push(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      errBytes += b.length;
      if (errBytes <= limit) err.push(b);
    });
    child.on("error", (e) => {
      spawnError = e.message;
    });
    // The program may exit without reading all of its input.
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? "");

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: code,
        signal: timedOut || outputExceeded ? null : signal,
        timeMs: Math.round(performance.now() - started),
        timedOut,
        outputExceeded,
        spawnError,
      });
    });
  });
}
