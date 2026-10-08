import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { defineServerPlugin } from "@cp-ide/plugin-api/server";
import { ClangdInstaller } from "./installer.ts";
import { type Exec, resolveClangd } from "./resolve.ts";
import { clangdSettings } from "./settings.ts";

const execFileAsync = promisify(execFile);
const exec: Exec = async (command, args) => (await execFileAsync(command, args, { timeout: 10_000, windowsHide: true })).stdout;

const installerFor = (dataDir: string) => new ClangdInstaller({ dir: path.join(dataDir, "clangd") });

const plugin = defineServerPlugin({
  id: "lsp-clangd",
  name: "C++ language server (clangd)",
  description: "Completions, hover, signature help, diagnostics as you type and go to definition for C++.",
  settings: clangdSettings,
  routes: (ctx) => {
    const installer = installerFor(ctx.dataDir);
    return new Hono()
      .get("/release", async (c) => c.json(await installer.latest()))
      .post("/install", async (c) => c.json({ path: await installer.install() }));
  },
  setup(ctx) {
    const installer = installerFor(ctx.dataDir);
    return ctx.languageServers.register({
      id: "clangd",
      name: "clangd",
      languages: ["cpp"],
      restartOn: ["lsp-clangd.command", "lsp-clangd.formatStyle", "cpp.compiler", "cpp.standard", "cpp.flags"],
      resolve: () =>
        resolveClangd(
          {
            command: String(ctx.settings.getRaw("lsp-clangd.command") ?? ""),
            compiler: ctx.settings.get("cpp.compiler"),
            standard: ctx.settings.get("cpp.standard"),
            flags: ctx.settings.get("cpp.flags"),
            formatStyle: String(ctx.settings.getRaw("lsp-clangd.formatStyle") ?? ""),
          },
          exec,
          () => installer.installed(),
        ),
    });
  },
});

export default plugin;
