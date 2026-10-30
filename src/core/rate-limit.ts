/**
 * Sliding-window limiter: at most `limit` allowed hits per key within any `windowMs` span. In-memory only.
 * Tracks at most `maxKeys` keys; when full, the least recently used key is evicted.
 */
export class RateLimiter {
  /** Insertion order = recency: a key is re-inserted on every hit, so the first key is the least recently used. */
  private hits = new Map<string, number[]>();
  private calls = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = 10_000,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    if (++this.calls % 256 === 0) this.prune(now);
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(now);
    this.hits.delete(key);
    if (this.hits.size >= this.maxKeys) {
      this.prune(now);
      const oldest = this.hits.keys().next();
      if (this.hits.size >= this.maxKeys && !oldest.done) this.hits.delete(oldest.value);
    }
    this.hits.set(key, recent);
    return allowed;
  }

  /** Drop keys whose hits have all left the window. Runs automatically every 256 calls. */
  prune(now: number = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }

  /** Number of keys currently tracked. */
  get size(): number {
    return this.hits.size;
  }
}
