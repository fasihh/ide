import { randomUUID } from "node:crypto";
import type { Disposable, ProblemsService } from "@cp-ide/plugin-api/server";
import type { Language } from "@cp-ide/shared";
import type { ImportResult } from "./messages.ts";
import { type CompanionPayload, sameTest, toCreateInput } from "./payload.ts";

/**
 * Create the problem, or — when one with the same URL exists — keep its code and add the samples it
 * does not have yet.
 */
export async function importProblem(problems: ProblemsService, payload: CompanionPayload, language: Language): Promise<ImportResult> {
  const existing = payload.url ? (await problems.list()).find((p) => p.url === payload.url) : undefined;
  if (existing) {
    const problem = await problems.get(existing.id);
    const fresh = payload.tests.map((t) => ({ input: t.input, expected: t.output })).filter((t) => !problem.tests.some((old) => sameTest(old, t)));
    if (fresh.length) await problems.writeTests(problem.id, [...problem.tests, ...fresh.map((t) => ({ id: randomUUID(), ...t, isSample: true, enabled: true }))]);
    return { id: problem.id, name: problem.meta.name, created: false, addedTests: fresh.length };
  }
  const problem = await problems.create(toCreateInput(payload, language));
  if (payload.interactive) await problems.updateMeta(problem.id, { interactive: true });
  return { id: problem.id, name: problem.meta.name, created: true, addedTests: problem.tests.length };
}

/**
 * Groups the problems of one parse (a whole contest arrives as `size` separate requests sharing a
 * batch id) so the web app can announce them once. Flushes when the batch is complete, or `waitMs`
 * after its last problem if some never arrive.
 */
export class BatchCollector<T> implements Disposable {
  private readonly batches = new Map<string, { size: number; items: T[]; timer?: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly flush: (items: T[]) => void,
    private readonly waitMs = 3000,
  ) {}

  add(batchId: string, size: number, item: T) {
    const batch = this.batches.get(batchId) ?? { size, items: [] };
    clearTimeout(batch.timer);
    batch.items.push(item);
    this.batches.set(batchId, batch);
    if (batch.items.length >= batch.size) this.finish(batchId);
    else batch.timer = setTimeout(() => this.finish(batchId), this.waitMs);
  }

  dispose() {
    for (const { timer } of this.batches.values()) clearTimeout(timer);
    this.batches.clear();
  }

  private finish(batchId: string) {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.batches.delete(batchId);
    this.flush(batch.items);
  }
}
