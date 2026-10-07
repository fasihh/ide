import { execFile } from "node:child_process";
import { Hono } from "hono";
import { defineServerPlugin } from "@cp-ide/plugin-api/server";

type ToolInfo = { name: string; command: string; ok: boolean; version: string };

function probe(name: string, command: string, args: string[]): Promise<ToolInfo> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`.trim().split(/\r?\n/)[0] ?? "";
      resolve({ name, command, ok: !err, version: err ? err.message : out });
    });
  });
}

/**
 * Server half: one typed route. The web half calls it with
 * `ctx.rpc<PluginRoutes<typeof plugin>>()` — fully type checked, no hand-written types.
 */
const plugin = defineServerPlugin({
  id: "toolchain",
  name: "Toolchain",
  description: "Reports compiler / interpreter versions.",
  routes: (ctx) =>
    new Hono().get("/info", async (c) => {
      const tools = await Promise.all([
        probe("C++ compiler", ctx.settings.get("cpp.compiler"), ["--version"]),
        probe("Python", ctx.settings.get("python.interpreter"), ["--version"]),
      ]);
      return c.json({ tools, platform: process.platform, node: process.version, problemsRoot: ctx.problems.root() });
    }),
});

export default plugin;
