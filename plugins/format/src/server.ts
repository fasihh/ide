import { spawn } from "node:child_process";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { defineServerPlugin } from "@cp-ide/plugin-api/server";
import { formatSettings } from "./settings.ts";

function splitArgs(s: string): string[] {
  return (s.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((a) => a.replace(/"/g, ""));
}

function runFormatter(command: string, source: string): Promise<{ ok: true; source: string } | { ok: false; error: string }> {
  const [cmd, ...args] = splitArgs(command);
  if (!cmd) return Promise.resolve({ ok: false, error: "No formatter command configured" });
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        error: e.code === "ENOENT" ? `"${cmd}" was not found. Install it (see Settings → Formatting) or change the command.` : e.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, source: out });
      else if (code !== null) resolve({ ok: false, error: err.trim() || `Formatter exited with code ${code}` });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(source);
  });
}

const plugin = defineServerPlugin({
  id: "format",
  name: "Formatter",
  description: "clang-format / black on demand.",
  settings: formatSettings,
  routes: (ctx) =>
    new Hono().post(
      "/",
      zValidator("json", z.object({ language: z.enum(["cpp", "python"]), source: z.string() })),
      async (c) => {
        const { language, source } = c.req.valid("json");
        const command = ctx.settings.getRaw(language === "cpp" ? "format.cppCommand" : "format.pythonCommand") as string;
        const res = await runFormatter(command, source);
        // Windows formatters often print CRLF; keep the line endings the source had.
        if (res.ok && !source.includes("\r\n")) res.source = res.source.replace(/\r\n/g, "\n");
        return c.json(res);
      },
    ),
});

export default plugin;
