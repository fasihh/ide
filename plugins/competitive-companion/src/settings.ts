import { defineSettings } from "@cp-ide/shared";

/** Shared by both halves: the server validates them, the web half shows them in Settings. */
export const companionSettings = defineSettings({
  "competitive-companion.port": {
    section: "Competitive Companion",
    label: "Port",
    description:
      "Where the browser extension sends problems. The extension posts to all of its built-in ports, so 10043 works without setting anything up and leaves CPH's 27121 free; for any other port, add it under the extension's custom ports.",
    type: "number",
    default: 10043,
    min: 1024,
    max: 65535,
  },
  "competitive-companion.openOnImport": {
    section: "Competitive Companion",
    label: "Open imported problems",
    description: "Open the problem (the first one, for a whole contest) as soon as it arrives.",
    type: "boolean",
    default: true,
  },
});
