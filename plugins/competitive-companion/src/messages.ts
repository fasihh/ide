/** Shapes shared by both halves: server-side status and import results, and what `broadcast` sends. */

export type ReceiverStatus =
  | { state: "stopped" }
  | { state: "listening"; port: number }
  | { state: "error"; port: number; error: string };

export type ImportResult = { id: string; name: string; created: boolean; addedTests: number };

export type CompanionMessage =
  | { kind: "status"; status: ReceiverStatus }
  | { kind: "imported"; problems: ImportResult[] }
  | { kind: "error"; message: string };
