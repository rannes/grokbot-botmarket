import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/core/rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to the limit within the window, then blocks", () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 10)).toBe(true);
    expect(rl.allow("a", 20)).toBe(true);
    expect(rl.allow("a", 30)).toBe(false);
    expect(rl.allow("a", 999)).toBe(false);
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("a", 1)).toBe(false);
  });

  it("re-allows as old hits slide out of the window", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 500)).toBe(true);
    expect(rl.allow("a", 900)).toBe(false);
    // the hit at t=0 expires at t=1000; the one at t=500 is still inside
    expect(rl.allow("a", 1000)).toBe(true);
    expect(rl.allow("a", 1001)).toBe(false);
    expect(rl.allow("a", 2600)).toBe(true);
  });

  it("blocked attempts do not extend the window", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 600)).toBe(false);
    expect(rl.allow("a", 1000)).toBe(true);
  });

  it("prunes keys whose hits have all expired", () => {
    const rl = new RateLimiter(1, 100);
    for (let i = 0; i < 50; i++) rl.allow(`k${i}`, 0);
    expect(rl.size).toBe(50);
    rl.prune(1000);
    expect(rl.size).toBe(0);
  });

  it("caps tracked keys and evicts the least recently used key", () => {
    const rl = new RateLimiter(1, 60_000, 3);
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("b", 1)).toBe(true);
    expect(rl.allow("c", 2)).toBe(true);
    expect(rl.allow("a", 3)).toBe(false); // touches a, so b is now the oldest
    expect(rl.allow("d", 4)).toBe(true);
    expect(rl.size).toBe(3);
    expect(rl.allow("b", 5)).toBe(true); // b was evicted, so it starts fresh
    expect(rl.allow("a", 6)).toBe(false);
    expect(rl.size).toBe(3);
  });

  it("defaults to 10 000 tracked keys", () => {
    const rl = new RateLimiter(1, 60_000);
    for (let i = 0; i < 10_050; i++) rl.allow(`k${i}`, 0);
    expect(rl.size).toBe(10_000);
  });
});
