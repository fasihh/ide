import { z } from "zod";
import type { CreateProblemInput, Language } from "@cp-ide/shared";

/**
 * What the Competitive Companion extension POSTs for each problem
 * (https://github.com/jmerle/competitive-companion#explanation). Unknown fields are ignored.
 */
export const companionPayloadSchema = z.object({
  name: z.string().min(1),
  group: z.string().default(""),
  url: z.string().default(""),
  interactive: z.boolean().default(false),
  memoryLimit: z.number().positive().optional(),
  timeLimit: z.number().positive().optional(),
  tests: z.array(z.object({ input: z.string(), output: z.string() })).default([]),
  input: z.object({ type: z.string() }).optional(),
  batch: z.object({ id: z.string(), size: z.number().int().positive() }).optional(),
});
export type CompanionPayload = z.infer<typeof companionPayloadSchema>;

/** Hosts the IDE already names (matches the New Problem dialog's platform list). */
const PLATFORM_BY_HOST: [RegExp, string][] = [
  [/(^|\.)codeforces\.(com|ml|es)$/, "codeforces"],
  [/(^|\.)cses\.fi$/, "cses"],
  [/(^|\.)atcoder\.jp$/, "atcoder"],
  [/(^|\.)leetcode\.(com|cn)$/, "leetcode"],
  [/(^|\.)codechef\.com$/, "codechef"],
  [/(^|\.)kattis\.com$/, "kattis"],
  [/(^|\.)usaco\.org$/, "usaco"],
  [/(^|\.)spoj\.com$/, "spoj"],
  [/(^|\.)hackerrank\.com$/, "hackerrank"],
  [/(^|\.)hackerearth\.com$/, "hackerearth"],
];

/** The site: from the URL's host, else the part of `group` before " - ", else "custom". */
export function platformOf(payload: Pick<CompanionPayload, "url" | "group">): string {
  try {
    const host = new URL(payload.url).hostname.toLowerCase();
    for (const [pattern, name] of PLATFORM_BY_HOST) if (pattern.test(host)) return name;
  } catch {
    // not a URL
  }
  const site = payload.group.split(" - ")[0]?.trim().toLowerCase();
  return site || "custom";
}

/** The contest: `group` without its leading "Site - " ("Codeforces - Round 945 (Div. 2)" → "Round 945 (Div. 2)"). */
export function contestOf(group: string): string {
  const dash = group.indexOf(" - ");
  return (dash >= 0 ? group.slice(dash + 3) : group).trim() || "misc";
}

export function toCreateInput(payload: CompanionPayload, language: Language): CreateProblemInput {
  return {
    name: payload.name,
    platform: platformOf(payload),
    group: contestOf(payload.group),
    url: payload.url || undefined,
    language,
    timeLimitMs: payload.timeLimit ? Math.round(payload.timeLimit) : undefined,
    memoryLimitMb: payload.memoryLimit ? Math.round(payload.memoryLimit) : undefined,
    tests: payload.tests.map((t) => ({ input: t.input, expected: t.output })),
  };
}

/** Same test, ignoring trailing whitespace and line-ending style. */
export const sameTest = (a: { input: string; expected: string }, b: { input: string; expected: string }) =>
  normalize(a.input) === normalize(b.input) && normalize(a.expected) === normalize(b.expected);

const normalize = (s: string) => s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
