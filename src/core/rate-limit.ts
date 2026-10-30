/** Sliding-window limiter: at most `limit` allowed hits per key within any `windowMs` span. In-memory only. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private calls = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    if (++this.calls % 256 === 0) this.prune(now);
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
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
