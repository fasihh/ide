import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "../paths.ts";

/**
 * Warm start for live (terminal) Python runs.
 *
 * Interpreter startup plus heavy imports (torch ≈ 3 s) are paid on every fresh process. After a run
 * exits we start a *standby* process that imports the leading import block of the script that just
 * ran, then blocks on stdin. The next run hands it the script path and it executes the script as
 * `__main__` — a fresh process each run (no state carried over), with the imports already loaded.
 *
 * Protocol: the bootstrap reads one line (the script path) from fd 0 byte by byte, so nothing past
 * that line is buffered away from the user's program.
 */
const BOOTSTRAP = `import ast, os, runpy, sys, traceback

def preload(path):
    try:
        with open(path, encoding="utf-8") as f:
            tree = ast.parse(f.read())
    except BaseException:
        return
    for i, node in enumerate(tree.body):
        if i == 0 and isinstance(node, ast.Expr) and isinstance(getattr(node, "value", None), ast.Constant):
            continue
        if isinstance(node, ast.Import):
            names = [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module == "__future__":
                continue
            names = [node.module]
        else:
            break
        for name in names:
            try:
                __import__(name)
            except BaseException:
                pass

def read_line():
    buf = b""
    while True:
        c = os.read(0, 1)
        if not c:
            os._exit(0)
        if c == b"\\n":
            return buf.decode("utf-8").rstrip("\\r")
        buf += c

if len(sys.argv) > 1:
    preload(sys.argv[1])
script = read_line()
if not script:
    os._exit(0)
sys.argv = [script]
try:
    runpy.run_path(script, run_name="__main__")
except SystemExit:
    raise
except BaseException as e:
    tb = e.__traceback__
    target = os.path.normcase(os.path.abspath(script))
    while tb is not None and os.path.normcase(os.path.abspath(tb.tb_frame.f_code.co_filename)) != target:
        tb = tb.tb_next
    traceback.print_exception(type(e), e, tb or e.__traceback__)
    sys.exit(1)
`;

const BOOTSTRAP_PATH = path.join(CACHE_DIR, "cp-ide-warm.py");
/** An unused standby is killed after this long (a torch process holds a few hundred MB). */
const IDLE_MS = 15 * 60_000;
const ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" };

type Standby = { child: ChildProcessWithoutNullStreams; interpreter: string; idle: ReturnType<typeof setTimeout> };

export class WarmPython {
  private standby: Standby | null = null;
  private initialized = false;

  private spawnWorker(interpreter: string, preloadFrom?: string) {
    if (!this.initialized) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(BOOTSTRAP_PATH, BOOTSTRAP);
      // A standby also exits by itself when the server dies (its stdin closes).
      process.once("exit", () => this.clear());
      this.initialized = true;
    }
    return spawn(interpreter, ["-X", "utf8", BOOTSTRAP_PATH, ...(preloadFrom ? [preloadFrom] : [])], {
      cwd: CACHE_DIR,
      windowsHide: true,
      env: ENV,
    });
  }

  /**
   * A process that will run `script` once it is written to stdin: the standby when there is one for
   * this interpreter (its imports may still be loading — it starts the script as soon as they finish),
   * otherwise a cold worker.
   */
  take(interpreter: string, script: string): { child: ChildProcessWithoutNullStreams; warm: boolean } {
    const s = this.standby;
    this.standby = null;
    let warm = false;
    let child: ChildProcessWithoutNullStreams;
    if (s && s.interpreter === interpreter && s.child.exitCode === null && !s.child.killed) {
      clearTimeout(s.idle);
      s.child.removeAllListeners("exit");
      child = s.child;
      warm = true;
    } else {
      if (s) this.kill(s);
      child = this.spawnWorker(interpreter);
    }
    child.stdin.write(`${script}\n`);
    return { child, warm };
  }

  /** Start the next standby, preloading the leading imports of `script` (called after a run exits). */
  prepare(interpreter: string, script: string) {
    this.clear();
    const child = this.spawnWorker(interpreter, script);
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    // Output printed while preloading stays buffered and shows up in the run that takes this process.
    const s: Standby = { child, interpreter, idle: setTimeout(() => this.clear(), IDLE_MS) };
    child.on("exit", () => {
      if (this.standby === s) {
        clearTimeout(s.idle);
        this.standby = null;
      }
    });
    this.standby = s;
  }

  clear() {
    if (this.standby) this.kill(this.standby);
    this.standby = null;
  }

  private kill(s: Standby) {
    clearTimeout(s.idle);
    try {
      s.child.kill("SIGKILL");
    } catch {}
  }
}
