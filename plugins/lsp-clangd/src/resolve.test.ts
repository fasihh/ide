import { test } from "node:test";
import assert from "node:assert/strict";
import { type ClangdConfig, DOWNLOAD_ACTION, type Exec, INSTALL_HINT, resolveClangd } from "./resolve.ts";

const config: ClangdConfig = { command: "clangd", compiler: "g++", standard: "c++20", flags: "-O2 -DLOCAL", formatStyle: "Google" };

/** An `Exec` that answers from a table and fails for anything else. */
const fakeExec =
  (outputs: Record<string, string>): Exec =>
  async (command, args) => {
    const out = outputs[[command, ...args].join(" ")];
    if (out === undefined) throw new Error(`ENOENT ${command}`);
    return out;
  };

const none = async () => null;

test("missing clangd is reported with install hints and the download action", async () => {
  assert.deepEqual(await resolveClangd(config, fakeExec({}), none), { ok: false, error: '"clangd" could not be started', hint: INSTALL_HINT, action: DOWNLOAD_ACTION });
});

test("the downloaded copy is used when clangd is not on PATH, but never over a configured command", async () => {
  const exec = fakeExec({ "/data/clangd_21/bin/clangd --version": "21", "g++ -dumpmachine": "x" });
  const res = await resolveClangd(config, exec, async () => "/data/clangd_21/bin/clangd");
  assert.ok(res.ok && res.launch.command === "/data/clangd_21/bin/clangd");
  const custom = await resolveClangd({ ...config, command: "/opt/clangd" }, exec, async () => "/data/clangd_21/bin/clangd");
  assert.equal(custom.ok, false);
});

test("fallback flags follow the runner's flags plus the compiler's target", async () => {
  const res = await resolveClangd({ ...config, command: '"C:/LLVM/bin/clangd.exe" --log=verbose' }, fakeExec({
    "C:/LLVM/bin/clangd.exe --version": "clangd version 21",
    "g++ -dumpmachine": "x86_64-w64-mingw32\n",
  }), none);
  assert.ok(res.ok);
  assert.equal(res.launch.command, "C:/LLVM/bin/clangd.exe");
  assert.equal(res.launch.args.at(-1), "--log=verbose", "extra arguments from the setting come last");
  assert.ok(res.launch.args.includes("--fallback-style=Google"));
  assert.deepEqual(res.launch.initializationOptions, { fallbackFlags: ["-std=c++20", "-O2", "-DLOCAL", "--target=x86_64-w64-mingw32"] });
});

test("without a working compiler clangd still starts, without --target", async () => {
  const res = await resolveClangd(config, fakeExec({ "clangd --version": "clangd version 21" }), none);
  assert.ok(res.ok);
  assert.deepEqual(res.launch.initializationOptions, { fallbackFlags: ["-std=c++20", "-O2", "-DLOCAL"] });
});
