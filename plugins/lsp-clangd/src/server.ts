import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineServerPlugin } from "@cp-ide/plugin-api/server";
import { type Exec, resolveClangd } from "./resolve.ts";
import { clangdSettings } from "./settings.ts";

const execFileAsync = promisify(execFile);
const exec: Exec = async (command, args) => (await execFileAsync(command, args, { timeout: 10_000, windowsHide: true })).stdout;

const plugin = defineServerPlugin({
  id: "lsp-clangd",
  name: "C++ language server (clangd)",
  description: "Completions, hover, signature help, diagnostics as you type and go to definition for C++.",
  settings: clangdSettings,
  setup(ctx) {
    return ctx.languageServers.register({
      id: "clangd",
      name: "clangd",
      languages: ["cpp"],
      restartOn: ["lsp-clangd.command", "cpp.compiler", "cpp.standard", "cpp.flags"],
      resolve: () =>
        resolveClangd(
          {
            command: String(ctx.settings.getRaw("lsp-clangd.command") ?? ""),
            compiler: ctx.settings.get("cpp.compiler"),
            standard: ctx.settings.get("cpp.standard"),
            flags: ctx.settings.get("cpp.flags"),
          },
          exec,
        ),
    });
  },
});

export default plugin;
