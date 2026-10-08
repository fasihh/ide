import { defineSettings } from "@cp-ide/shared";

/** Shared by both halves: the server validates them, the web half shows them in Settings. */
export const formatSettings = defineSettings({
  "format.cppCommand": {
    section: "Formatting",
    label: "C++ formatter",
    description: "Command that reads source on stdin and prints the formatted code. Install with `pip install clang-format`.",
    type: "string",
    default: "clang-format --style=Google",
  },
  "format.pythonCommand": {
    section: "Formatting",
    label: "Python formatter",
    description: "Command that reads source on stdin and prints the formatted code. Install with `pip install black`.",
    type: "string",
    default: "black -q -",
  },
  "format.cppEngine": {
    section: "Formatting",
    label: "C++ formats with",
    description: "The language server (clangd, style from Settings → C++ language server) needs no separate clang-format install.",
    type: "enum",
    options: [
      { value: "command", label: "C++ formatter command" },
      { value: "languageServer", label: "Language server (clangd)" },
    ],
    default: "command",
  },
  "format.pythonEngine": {
    section: "Formatting",
    label: "Python formats with",
    description: "Falls back to the command when the language server cannot format (basedpyright does not).",
    type: "enum",
    options: [
      { value: "command", label: "Python formatter command" },
      { value: "languageServer", label: "Language server" },
    ],
    default: "command",
  },
  "format.onSave": {
    section: "Formatting",
    label: "Format on save (Ctrl+S)",
    type: "boolean",
    default: false,
  },
});
