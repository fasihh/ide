import { defineSettings } from "@cp-ide/shared";

/** Shared by both halves: the server validates them, the web half shows them in Settings. */
export const warmSettings = defineSettings({
  "python-warm.enabled": {
    section: "Python",
    label: "Warm start for terminal runs",
    description:
      "Keep a Python process ready with your last script's leading imports already loaded (e.g. torch, numpy), so Playground and terminal runs skip the import wait. Tests always use a fresh process.",
    type: "boolean",
    default: true,
  },
});
