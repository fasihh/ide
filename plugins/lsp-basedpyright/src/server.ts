import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { defineServerPlugin } from "@cp-ide/plugin-api/server";
import { type Exec, resolveBasedPyright } from "./resolve.ts";
import { basedpyrightSettings } from "./settings.ts";

const execFileAsync = promisify(execFile);
const exec: Exec = async (command, args) => (await execFileAsync(command, args, { timeout: 10_000, windowsHide: true })).stdout;
const require = createRequire(import.meta.url);

const plugin = defineServerPlugin({
  id: "lsp-basedpyright",
  name: "Python language server (basedpyright)",
  description: "Completions, hover, signature help, type diagnostics and go to definition for Python. Bundled — nothing to install.",
  settings: basedpyrightSettings,
  setup(ctx) {
    return ctx.languageServers.register({
      id: "basedpyright",
      name: "basedpyright",
      languages: ["python"],
      restartOn: ["lsp-basedpyright.typeCheckingMode", "python.interpreter"],
      resolve: () =>
        resolveBasedPyright(
          {
            interpreter: ctx.settings.get("python.interpreter"),
            typeCheckingMode: String(ctx.settings.getRaw("lsp-basedpyright.typeCheckingMode") ?? "basic"),
          },
          { langserverEntry: () => require.resolve("basedpyright/langserver.index.js"), node: process.execPath, exec },
        ),
    });
  },
});

export default plugin;
