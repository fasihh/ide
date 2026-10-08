import type { ProblemStatus } from "@cp-ide/shared";

export const STATUS_DOT: Record<ProblemStatus, string> = {
  todo: "bg-muted-foreground/40",
  attempted: "bg-verdict-tle",
  solved: "bg-verdict-ac",
};
export const STATUS_LABEL: Record<ProblemStatus, string> = { todo: "To do", attempted: "Tried", solved: "Solved" };
export const STATUS_RANK: Record<ProblemStatus, number> = { attempted: 0, todo: 1, solved: 2 };

export type Sort = "recent" | "name" | "status";
export const SORTS: readonly [Sort, string][] = [
  ["recent", "Recently changed"],
  ["name", "Name"],
  ["status", "Status (tried first)"],
];

/** The explorer's persisted view options. */
export type ViewState = { sort: Sort; status: ProblemStatus | "all"; tags: string[]; collapsed: string[]; recentOpen: boolean };
export const DEFAULT_VIEW: ViewState = { sort: "recent", status: "all", tags: [], collapsed: [], recentOpen: true };

export type StatusCounts = Record<ProblemStatus | "all", number>;
