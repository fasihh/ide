/**
 * Drives WarmPythonLauncher against the real interpreter (`python` on PATH), without the runner.
 */
import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LaunchOptions, Program } from "@cp-ide/plugin-api/server";
import { WarmPythonLauncher } from "./launcher.ts";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-ide-warm-test-"));
const opts: LaunchOptions = { cwd: dir, env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" } };
const bootstrap = fileURLToPath(new URL("./warm_bootstrap.py", import.meta.url));

let enabled = true;
const createLauncher = () => new WarmPythonLauncher({ bootstrap, enabled: () => enabled, idleMs: 60_000 });
let launcher = createLauncher();
let scripts = 0;

beforeEach(() => {
  launcher.dispose();
  enabled = true;
  launcher = createLauncher();
});
after(async () => {
  launcher.dispose();
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

async function python(source: string): Promise<Program> {
  const script = path.join(dir, `script${++scripts}.py`);
  await fs.writeFile(script, source);
  return { language: "python", interpreter: "python", flags: ["-X", "utf8"], script };
}

async function run(source: string, stdin?: string) {
  const child = launcher.launch(await python(source), opts);
  assert.ok(child, "the launcher takes Python programs");
  let out = "";
  let err = "";
  child.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
  child.stderr.on("data", (b: Buffer) => (err += b.toString("utf8")));
  if (stdin !== undefined) child.stdin.end(stdin);
  const exitCode = await new Promise<number | null>((r) => child.on("close", r));
  return { exitCode, out: out.replace(/\r\n/g, "\n"), err };
}

const PROBE = 'import sys\nprint("fractions" in sys.modules, __name__)\n';

describe("WarmPythonLauncher", () => {
  test("declines C++ programs and Python while disabled", async () => {
    assert.equal(launcher.launch({ language: "cpp", executable: "a.exe", source: "a.cpp" }, opts), null);
    enabled = false;
    assert.equal(launcher.launch(await python("print(1)"), opts), null);
  });

  test("the next run reuses a standby that preloaded the previous script's imports", async () => {
    assert.equal((await run(PROBE)).out, "False __main__\n", "the first run is cold");
    await run('"""doc"""\nimport fractions\n');
    assert.equal((await run(PROBE)).out, "True __main__\n");
  });

  test("scripts resolve sibling modules and see their own argv", async () => {
    await fs.writeFile(path.join(dir, "helper.py"), "VALUE = 42\n");
    const res = await run("import sys, helper\nprint(helper.VALUE, sys.argv[0].endswith('.py'))\n");
    assert.equal(res.out, "42 True\n");
  });

  test("tracebacks start in the user's script; exit code 1", async () => {
    const res = await run('def f():\n    raise ValueError("boom")\nf()\n');
    assert.equal(res.exitCode, 1);
    assert.match(res.err, /script\d+\.py", line 3/);
    assert.match(res.err, /ValueError: boom/);
    assert.doesNotMatch(res.err, /runpy|warm_bootstrap/);
  });

  test("stdin carries only user input", async () => {
    const res = await run("import sys\nprint(sys.stdin.buffer.read().decode().upper(), end='')\n", "abc\ndef\n");
    assert.equal(res.out, "ABC\nDEF\n");
  });

  test("clear() drops the standby", async () => {
    await run("import fractions\n");
    launcher.clear();
    assert.equal((await run(PROBE)).out, "False __main__\n");
  });
});
