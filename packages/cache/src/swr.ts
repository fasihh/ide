import { LruCache } from "./lru.ts";

export interface SwrCacheOptions<V> {
  /** Entries kept before the least recently used is evicted. */
  maxEntries: number;
  /** A hit younger than this is returned without refreshing. 0 = refresh after every hit. */
  freshForMs?: number;
  /** Results that should not be stored (e.g. empty lists). Defaults to storing everything. */
  shouldCache?: (value: V) => boolean;
  /** Clock, injectable for tests. */
  now?: () => number;
}

type Entry<V> = { value: V; storedAt: number };

/**
 * Stale-while-revalidate cache for slow async lookups: a hit is returned at once and, when it is no
 * longer fresh, refreshed in the background so the next hit is up to date. A miss waits for the
 * loader. Concurrent loads of one key share a single call. Failed loads are never stored.
 */
export class SwrCache<V> {
  private readonly entries: LruCache<Entry<V>>;
  private readonly inflight = new Map<string, Promise<V>>();
  private generation = 0;

  constructor(private readonly options: SwrCacheOptions<V>) {
    this.entries = new LruCache(options.maxEntries);
  }

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (!hit) return this.load(key, load);
    if (this.now() - hit.storedAt >= (this.options.freshForMs ?? 0)) this.load(key, load).catch(() => {}); // keep serving the old value
    return hit.value;
  }

  /** The stored value without loading or refreshing. */
  peek(key: string): V | undefined {
    return this.entries.get(key)?.value;
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  deleteWhere(matches: (key: string) => boolean) {
    this.entries.deleteWhere(matches);
  }

  /** Drop everything, including results of loads still in flight. */
  clear() {
    this.generation++;
    this.entries.clear();
    this.inflight.clear();
  }

  private load(key: string, load: () => Promise<V>): Promise<V> {
    const running = this.inflight.get(key);
    if (running) return running;
    const generation = this.generation;
    const promise = load()
      .then((value) => {
        if (generation === this.generation && (this.options.shouldCache?.(value) ?? true)) {
          this.entries.set(key, { value, storedAt: this.now() });
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  private now() {
    return (this.options.now ?? Date.now)();
  }
}
