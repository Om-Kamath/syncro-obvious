/**
 * Bounded least-recently-used cache backed by a Map (which preserves
 * insertion order). Values must not be `undefined` — `get` uses it as the
 * miss sentinel.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly maxEntries: number) {
    if (maxEntries < 1) throw new Error('LruCache requires maxEntries >= 1');
  }

  get size(): number {
    return this.entries.size;
  }

  /** Returns the cached value, or undefined on a miss. Refreshes recency. */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // Re-insert to move the key to the most-recently-used position.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Inserts or updates a value, evicting the LRU entry when full. */
  set(key: K, value: V): void {
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const lruKey = this.entries.keys().next().value;
      if (lruKey === undefined) break;
      this.entries.delete(lruKey);
    }
    this.entries.set(key, value);
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }
}
