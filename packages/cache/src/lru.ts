/** A size-bounded map that evicts the least recently used entry. */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(readonly maxEntries: number) {
    if (maxEntries < 1) throw new Error("maxEntries must be at least 1");
  }

  get size() {
    return this.entries.size;
  }

  has(key: string) {
    return this.entries.has(key);
  }

  /** The value, marking it most recently used. */
  get(key: string): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V) {
    this.entries.delete(key);
    this.entries.set(key, value);
    // Map iteration order is insertion order, so the first key is the least recently used.
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
  }

  delete(key: string) {
    return this.entries.delete(key);
  }

  /** Remove every entry whose key matches, e.g. all entries for one document. */
  deleteWhere(matches: (key: string) => boolean) {
    for (const key of [...this.entries.keys()]) if (matches(key)) this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}
