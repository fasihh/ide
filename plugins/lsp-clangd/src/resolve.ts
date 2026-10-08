import type { LanguageServerResolution } from "@cp-ide/plugin-api/server";
import { splitArgs } from "@cp-ide/shared";

/** Runs a command and returns its stdout; rejects when it cannot be started or fails. */
export type Exec = (command: string, args: string[]) => Promise<string>;

export interface ClangdConfig {
  /** `lsp-clangd.command`: the executable, optionally followed by extra clangd arguments. */
  command: string;
  /** `cpp.compiler`, asked for its target so clang uses the same standard library headers. */
  compiler: string;
  standard: string;
  flags: string;
  /** `lsp-clangd.formatStyle`: style when formatting without a `.clang-format` file. */
  formatStyle: string;
}

/** Offered in the status bar when no clangd can be started (the command is registered by web.tsx). */
export const DOWNLOAD_ACTION = { label: "Download clangd", command: "lsp-clangd.install" };

export const INSTALL_HINT =
  "Install clangd and make sure it is on PATH — e.g. `winget install LLVM.LLVM`, `pip install clangd`, `brew install llvm` or your package manager — or set the command in Settings → C++ language server.";

/**
 * Problems are single files without a compilation database, so clangd builds every file with
 * `fallbackFlags`. The rest keeps it light: no background index, no auto-inserted includes.
 */
const CLANGD_ARGS = ["--background-index=false", "--header-insertion=never", "--completion-style=detailed", "--pch-storage=memory", "--log=error"];

/**
 * Which clangd to run: the configured command, else (when that is the default `clangd` and it is not on
 * PATH) a copy downloaded by this plugin. Nothing found → unavailable, offering the download.
 */
export async function resolveClangd(config: ClangdConfig, exec: Exec, downloaded: () => Promise<string | null>): Promise<LanguageServerResolution> {
  const [configured, ...extraArgs] = splitArgs(config.command);
  if (!configured) return { ok: false, error: "No clangd command is configured", hint: INSTALL_HINT, action: DOWNLOAD_ACTION };
  const runs = (cmd: string) => exec(cmd, ["--version"]).then(() => true, () => false);
  let command: string | null = (await runs(configured)) ? configured : null;
  if (!command && config.command.trim() === "clangd") {
    const copy = await downloaded();
    if (copy && (await runs(copy))) command = copy;
  }
  if (!command) return { ok: false, error: `"${configured}" could not be started`, hint: INSTALL_HINT, action: DOWNLOAD_ACTION };
  return {
    ok: true,
    launch: {
      command,
      args: [...CLANGD_ARGS, ...(config.formatStyle.trim() ? [`--fallback-style=${config.formatStyle.trim()}`] : []), ...extraArgs],
      initializationOptions: { fallbackFlags: await fallbackFlags(config, exec) },
    },
  };
}

/**
 * The flags the runner compiles with, plus `--target=<compiler's triple>`: with the GCC triple
 * (e.g. `x86_64-w64-mingw32`) clang finds that GCC's libstdc++ (`bits/stdc++.h`) on its own.
 */
async function fallbackFlags(config: ClangdConfig, exec: Exec): Promise<string[]> {
  const flags = [`-std=${config.standard}`, ...splitArgs(config.flags)];
  const [compiler] = splitArgs(config.compiler);
  if (!compiler) return flags;
  try {
    const triple = (await exec(compiler, ["-dumpmachine"])).trim();
    if (triple) flags.push(`--target=${triple}`);
  } catch {
    // No compiler: clangd still works, with its default headers.
  }
  return flags;
}
