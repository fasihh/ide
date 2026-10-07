import { defineSettings } from "@cp-ide/shared";

/** Settings used by both halves (validated on the server, shown in Settings by the web half). */
export const playgroundSettings = defineSettings({
  "playground.folder": {
    section: "Playground",
    label: "Playground folder",
    description: "Where playground files are saved. Empty = ~/.cp-ide/plugins/playground. `~` expands to your home folder.",
    type: "string",
    default: "",
    placeholder: "~/.cp-ide/plugins/playground",
  },
  "playground.maxRunSeconds": {
    section: "Playground",
    label: "Stop programs after (seconds)",
    description: "Safety limit for terminal runs. 0 = no limit.",
    type: "number",
    default: 300,
    min: 0,
    max: 86400,
  },
});

/** Messages on the playground run socket (`/api/plugins/playground/run`). */
export type ClientMessage =
  | { type: "start"; language: "cpp" | "python"; source: string; fileName: string }
  | { type: "stdin"; data: string }
  | { type: "eof" }
  | { type: "kill" };

export type ServerMessage =
  | { type: "compiling" }
  | { type: "compiled"; ok: boolean; stderr: string; timeMs: number; cached: boolean }
  | { type: "started" }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; exitCode: number | null; timeMs: number; message?: string }
  | { type: "error"; message: string };
