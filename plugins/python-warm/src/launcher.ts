import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Writable } from "node:stream";
import type { Disposable, LaunchOptions, ProcessLauncher, Program } from "@cp-ide/plugin-api/server";

type PythonProgram = Extract<Program, { language: "python" }>;

export interface WarmPythonOptions {
  /** Absolute path of `warm_bootstrap.py`. */
  bootstrap: string;
  /** Checked on every launch; when false, Python runs are left to the runner. */
  enabled: () => boolean;
  /** An unused standby is killed after this long (a torch process holds a few hundred MB). */
  idleMs: number;
}

/** A bootstrap process and the pipe (fd 3) it reads the script path from. */
type Worker = { child: ChildProcessWithoutNullStreams; control: Writable };
type Standby = Worker & { key: string; idle: ReturnType<typeof setTimeout> };

/**
 * Starts live Python runs through `warm_bootstrap.py`. After each run exits, a standby process
 * imports that script's leading imports and waits; the next run hands it the script path on fd 3.
 * Every run is still a fresh process — only the imports are already done.
 */
export class WarmPythonLauncher implements ProcessLauncher, Disposable {
  readonly id = "python-warm";
  private standby: Standby | null = null;

  constructor(private readonly options: WarmPythonOptions) {}

  launch(program: Program, opts: LaunchOptions): ChildProcessWithoutNullStreams | null {
    if (program.language !== "python" || !this.options.enabled()) return null;
    const worker = this.takeStandby(program, opts) ?? this.spawnWorker(program, opts);
    worker.control.end(program.script);
    // Get the next run's process ready while the user reads this one's output.
    worker.child.once("exit", () => {
      if (this.options.enabled()) this.prepare(program, opts);
    });
    return worker.child;
  }

  /** Kill the standby, e.g. when the configuration it was started with changes. */
  clear() {
    const s = this.standby;
    this.standby = null;
    if (!s) return;
    clearTimeout(s.idle);
    s.child.kill();
  }

  dispose() {
    this.clear();
  }

  private prepare(program: PythonProgram, opts: LaunchOptions) {
    this.clear();
    const worker = this.spawnWorker(program, opts, program.script);
    const standby: Standby = { ...worker, key: standbyKey(program, opts), idle: setTimeout(() => this.clear(), this.options.idleMs) };
    worker.child.on("error", () => {}); // e.g. the interpreter was uninstalled; the next run reports it
    worker.child.once("exit", () => {
      if (this.standby !== standby) return;
      clearTimeout(standby.idle);
      this.standby = null;
    });
    this.standby = standby;
  }

  /** The standby, if it was started for the same interpreter, flags and folder and is still alive. */
  private takeStandby(program: PythonProgram, opts: LaunchOptions): Worker | null {
    const s = this.standby;
    if (!s) return null;
    this.standby = null;
    clearTimeout(s.idle);
    if (s.key === standbyKey(program, opts) && s.child.exitCode === null) return s;
    s.child.kill();
    return null;
  }

  private spawnWorker(program: PythonProgram, opts: LaunchOptions, preloadFrom?: string): Worker {
    const args = [...program.flags, this.options.bootstrap, ...(preloadFrom ? [preloadFrom] : [])];
    const child = spawn(program.interpreter, args, { cwd: opts.cwd, env: opts.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe", "pipe"] });
    // stdio is four pipes: the standard streams are non-null and fd 3 is writable from this side.
    const control = child.stdio[3] as Writable;
    control.on("error", () => {}); // the process may exit before reading it
    return { child: child as ChildProcessWithoutNullStreams, control };
  }
}

const standbyKey = (program: PythonProgram, opts: LaunchOptions) => JSON.stringify([program.interpreter, program.flags, opts.cwd]);
