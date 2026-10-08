import { defineSettings } from "@cp-ide/shared";

/** Shared by both halves: the server validates them, the web half shows them in Settings. */
export const basedpyrightSettings = defineSettings({
  "lsp-basedpyright.typeCheckingMode": {
    section: "Python language server",
    label: "Type checking",
    description: "How strict the type diagnostics are. `basic` flags real mistakes without nagging about missing annotations.",
    type: "enum",
    options: [
      { value: "off", label: "Off (syntax and unresolved names only)" },
      { value: "basic", label: "Basic" },
      { value: "standard", label: "Standard" },
      { value: "strict", label: "Strict" },
      { value: "recommended", label: "Recommended (basedpyright default, very strict)" },
    ],
    default: "basic",
  },
});
