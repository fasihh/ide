import { test } from "node:test";
import assert from "node:assert/strict";
import { LruCache } from "./lru.ts";
import { SwrCache } from "./swr.ts";

test("LruCache evicts the least recently used entry", () => {
  const lru = new LruCache<number>(2);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.get("a"); // a is now the most recent
  lru.set("c", 3);
  assert.equal(lru.has("b"), false);
  assert.deepEqual([lru.get("a"), lru.get("c")], [1, 3]);
  lru.deleteWhere((k) => k === "a");
  assert.equal(lru.size, 1);
});

/** A loader whose calls are counted and resolved by hand. */
function controlledLoader() {
  const calls: ((v: string) => void)[] = [];
  const load = () => new Promise<string>((resolve) => calls.push(resolve));
  return { load, calls };
}

test("a miss waits; a hit returns at once and refreshes in the background", async () => {
  let now = 0;
  const cache = new SwrCache<string>({ maxEntries: 10, now: () => now });
  const { load, calls } = controlledLoader();

  const first = cache.get("np.", load);
  calls[0]!("v1");
  assert.equal(await first, "v1");

  now = 100;
  assert.equal(await cache.get("np.", load), "v1", "served from the cache");
  assert.equal(calls.length, 2, "and refreshed in the background");
  calls[1]!("v2");
  await Promise.resolve();
  assert.equal(cache.peek("np."), "v2", "the next hit sees the refreshed value");
});

test("fresh hits skip the refresh; concurrent loads share one call", async () => {
  let now = 0;
  const cache = new SwrCache<string>({ maxEntries: 10, freshForMs: 1000, now: () => now });
  const { load, calls } = controlledLoader();

  const a = cache.get("k", load);
  const b = cache.get("k", load);
  assert.equal(calls.length, 1);
  calls[0]!("v");
  assert.deepEqual(await Promise.all([a, b]), ["v", "v"]);

  now = 500;
  await cache.get("k", load);
  assert.equal(calls.length, 1, "still fresh: no refresh");
});

test("failed and rejected-by-shouldCache loads are not stored; clear() ignores late results", async () => {
  const cache = new SwrCache<string[]>({ maxEntries: 10, shouldCache: (v) => v.length > 0 });
  await assert.rejects(cache.get("k", () => Promise.reject(new Error("server gone"))));
  assert.equal(cache.peek("k"), undefined);
  await cache.get("k", async () => []);
  assert.equal(cache.peek("k"), undefined, "empty results are not cached");

  let resolve!: (v: string[]) => void;
  const late = cache.get("k", () => new Promise((r) => (resolve = r)));
  cache.clear();
  resolve(["stale"]);
  await late;
  assert.equal(cache.peek("k"), undefined, "a load started before clear() is not stored");
});
