import type { LanguageServerResolution } from "@cp-ide/plugin-api/server";
import { splitArgs } from "@cp-ide/shared";

/** Runs a command and returns its stdout; rejects when it cannot be started or fails. */
export type Exec = (command: string, args: string[]) => Promise<string>;

export interface BasedPyrightConfig {
  /** `python.interpreter` — basedpyright reads installed packages (numpy, torch…) from it. */
  interpreter: string;
  typeCheckingMode: string;
}

export interface BasedPyrightEnvironment {
  /** Absolute path of basedpyright's `langserver.index.js` (an npm dependency of this plugin). */
  langserverEntry(): string;
  /** The Node.js executable to run it with. */
  node: string;
  exec: Exec;
}

export async function resolveBasedPyright(config: BasedPyrightConfig, env: BasedPyrightEnvironment): Promise<LanguageServerResolution> {
  let entry: string;
  try {
    entry = env.langserverEntry();
  } catch {
    return { ok: false, error: "basedpyright is not installed", hint: "Run `pnpm install` in the cp-ide folder." };
  }
  return {
    ok: true,
    launch: {
      command: env.node,
      args: [entry, "--stdio"],
      configuration: {
        python: { pythonPath: await pythonExecutable(config.interpreter, env.exec) },
        // basedpyright asks for the "basedpyright" section and reads `analysis` inside it.
        basedpyright: { analysis: { typeCheckingMode: config.typeCheckingMode, diagnosticMode: "openFilesOnly", autoSearchPaths: true, useLibraryCodeForTypes: true } },
      },
    },
  };
}

/** Absolute path of the configured interpreter, or undefined (basedpyright then searches PATH itself). */
async function pythonExecutable(interpreter: string, exec: Exec): Promise<string | undefined> {
  const [command, ...args] = splitArgs(interpreter);
  if (!command) return undefined;
  try {
    return (await exec(command, [...args, "-c", "import sys; print(sys.executable)"])).trim() || undefined;
  } catch {
    return undefined;
  }
}
