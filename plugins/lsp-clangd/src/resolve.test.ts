import { test } from "node:test";
import assert from "node:assert/strict";
import { type ClangdConfig, type Exec, INSTALL_HINT, resolveClangd } from "./resolve.ts";

const config: ClangdConfig = { command: "clangd", compiler: "g++", standard: "c++20", flags: "-O2 -DLOCAL" };

/** An `Exec` that answers from a table and fails for anything else. */
const fakeExec =
  (outputs: Record<string, string>): Exec =>
  async (command, args) => {
    const out = outputs[[command, ...args].join(" ")];
    if (out === undefined) throw new Error(`ENOENT ${command}`);
    return out;
  };

test("missing clangd is reported with install hints", async () => {
  assert.deepEqual(await resolveClangd(config, fakeExec({})), { ok: false, error: '"clangd" could not be started', hint: INSTALL_HINT });
});

test("fallback flags follow the runner's flags plus the compiler's target", async () => {
  const res = await resolveClangd({ ...config, command: '"C:/LLVM/bin/clangd.exe" --log=verbose' }, fakeExec({
    "C:/LLVM/bin/clangd.exe --version": "clangd version 21",
    "g++ -dumpmachine": "x86_64-w64-mingw32\n",
  }));
  assert.ok(res.ok);
  assert.equal(res.launch.command, "C:/LLVM/bin/clangd.exe");
  assert.equal(res.launch.args.at(-1), "--log=verbose", "extra arguments from the setting come last");
  assert.deepEqual(res.launch.initializationOptions, { fallbackFlags: ["-std=c++20", "-O2", "-DLOCAL", "--target=x86_64-w64-mingw32"] });
});

test("without a working compiler clangd still starts, without --target", async () => {
  const res = await resolveClangd(config, fakeExec({ "clangd --version": "clangd version 21" }));
  assert.ok(res.ok);
  assert.deepEqual(res.launch.initializationOptions, { fallbackFlags: ["-std=c++20", "-O2", "-DLOCAL"] });
});
