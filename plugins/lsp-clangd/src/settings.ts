import { defineSettings } from "@cp-ide/shared";

/** Shared by both halves: the server validates them, the web half shows them in Settings. */
export const clangdSettings = defineSettings({
  "lsp-clangd.command": {
    section: "C++ language server",
    label: "clangd command",
    description: "Command (or full path) used to start clangd, optionally with extra arguments. Leave as `clangd` to use the one on PATH.",
    type: "string",
    default: "clangd",
  },
  "lsp-clangd.formatStyle": {
    section: "C++ language server",
    label: "Formatting style",
    description: "clang-format style used when formatting through clangd and no .clang-format file is found (Google, LLVM, Chromium, Mozilla, WebKit, Microsoft, GNU).",
    type: "string",
    default: "Google",
  },
});
