import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { type BasedPyrightEnvironment, resolveBasedPyright } from "./resolve.ts";

const config = { interpreter: "python", typeCheckingMode: "basic" };

test("runs the bundled language server with the interpreter's absolute path", async () => {
  const env: BasedPyrightEnvironment = {
    langserverEntry: () => "/deps/basedpyright/langserver.index.js",
    node: "/usr/bin/node",
    exec: async (command, args) => {
      assert.deepEqual([command, ...args], ["python", "-c", "import sys; print(sys.executable)"]);
      return "C:\\Python312\\python.exe\r\n";
    },
  };
  const res = await resolveBasedPyright(config, env);
  assert.ok(res.ok);
  assert.deepEqual([res.launch.command, ...res.launch.args], ["/usr/bin/node", "/deps/basedpyright/langserver.index.js", "--stdio"]);
  assert.deepEqual(res.launch.configuration?.python, { pythonPath: "C:\\Python312\\python.exe" });
  assert.equal((res.launch.configuration?.["basedpyright.analysis"] as { typeCheckingMode: string }).typeCheckingMode, "basic");
});

test("a missing interpreter still starts the server; a missing package does not", async () => {
  const noPython = await resolveBasedPyright(config, { langserverEntry: () => "x.js", node: "node", exec: () => Promise.reject(new Error("ENOENT")) });
  assert.ok(noPython.ok);
  assert.deepEqual(noPython.launch.configuration?.python, { pythonPath: undefined });

  const notInstalled = await resolveBasedPyright(config, { langserverEntry: () => { throw new Error("MODULE_NOT_FOUND"); }, node: "node", exec: async () => "" });
  assert.equal(notInstalled.ok, false);
});

test("the dependency resolves where server.ts looks for it", () => {
  const entry = createRequire(import.meta.url).resolve("basedpyright/langserver.index.js");
  assert.match(entry, /basedpyright[\\/]langserver\.index\.js$/);
});
