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
  "format.onSave": {
    section: "Formatting",
    label: "Format on save (Ctrl+S)",
    type: "boolean",
    default: false,
  },
});
