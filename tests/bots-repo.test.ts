import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BotsRepo, type NewBot } from "../src/db/bots-repo.js";
import type { SqlDatabase } from "../src/db/sql.js";
import { visitorHash } from "../src/db/visitor.js";
import { exportCatalog, parseCatalog } from "../src/core/catalog.js";
import { testBackends } from "./helpers/backends.js";

let clock = new Date("2026-01-01T00:00:00.000Z");

function mk(name: string, extra: Partial<NewBot> = {}): NewBot {
  return {
    name,
    tagline: `${name} tagline`,
    descriptionMd: "# desc",
    category: "engineering",
    tags: ["a", "b"],
    authorName: "Ann",
    authorUrl: null,
    avatarShape: null,
    avatarColor: null,
    imageUrl: null,
    templateId: null,
    recipe: null,
    sourceUrl: null,
    homepageUrl: null,
    ...extra,
  };
}

const tick = () => (clock = new Date(clock.getTime() + 1000));

describe.each(testBackends())("BotsRepo ($driver)", (backend) => {
  let db: SqlDatabase;
  let repo: BotsRepo;

  beforeEach(async () => {
    clock = new Date("2026-01-01T00:00:00.000Z");
    db = await backend.open();
    repo = new BotsRepo(db, () => clock);
  });
  afterEach(async () => {
    await backend.dispose(db);
  });

  it("reports the database driver and answers ping", async () => {
    expect(repo.driver).toBe(backend.driver);
    await expect(repo.ping()).resolves.toBeUndefined();
  });

  it("round-trips recipe and tags", async () => {
    const b = await repo.insert(mk("Foo Bot", { recipe: { x: [1, 2], y: "z" }, tags: ["t1", "t2"] }));
    expect(b.slug).toBe("foo-bot");
    expect(b.status).toBe("published");
    expect(b.featured).toBe(false);
    expect(b.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(await repo.get("foo-bot")).toEqual(b);
    expect((await repo.get("foo-bot"))?.recipe).toEqual({ x: [1, 2], y: "z" });
    expect((await repo.get("foo-bot"))?.tags).toEqual(["t1", "t2"]);
    expect(await repo.get("nope")).toBeNull();
  });

  it("keeps suffixed slugs within 64 chars so the catalog re-imports", async () => {
    const name = `${"a".repeat(61)} bc`; // slug: 61 a's + "-bc" = 64 chars
    const first = await repo.insert(mk(name, { templateId: "AbCdEfGhIjKlMnOpQrStU" }));
    expect(first.slug).toHaveLength(64);
    const second = await repo.insert(mk(name, { templateId: "AbCdEfGhIjKlMnOpQrStU" }));
    expect(second.slug).toBe(`${"a".repeat(61)}-2`);
    expect(second.slug.length).toBeLessThanOrEqual(64);
    const third = await repo.insert(mk("b".repeat(64), { templateId: "AbCdEfGhIjKlMnOpQrStU" }));
    const fourth = await repo.insert(mk("b".repeat(64), { templateId: "AbCdEfGhIjKlMnOpQrStU" }));
    expect(fourth.slug).toBe(`${"b".repeat(62)}-2`);
    const parsed = parseCatalog(JSON.parse(JSON.stringify(exportCatalog([first, second, third, fourth], { name: "T", url: null }))));
    expect(parsed.ok).toBe(true);
  });

  it("insert with duplicate slug gets a numeric suffix", async () => {
    expect((await repo.insert(mk("x", { slug: "foo" }))).slug).toBe("foo");
    expect((await repo.insert(mk("x", { slug: "foo" }))).slug).toBe("foo-2");
    expect((await repo.insert(mk("x", { slug: "foo" }))).slug).toBe("foo-3");
  });

  it("list defaults to published, newest first", async () => {
    await repo.insert(mk("Old"));
    tick();
    await repo.insert(mk("Pend", { status: "pending" }));
    tick();
    await repo.insert(mk("New"));
    expect((await repo.list()).map((b) => b.name)).toEqual(["New", "Old"]);
    expect(await repo.list({ status: "all" })).toHaveLength(3);
    expect((await repo.list({ status: "pending" })).map((b) => b.name)).toEqual(["Pend"]);
    expect(await repo.count()).toBe(2);
    expect(await repo.count({ status: "all" })).toBe(3);
  });

  it("q matches name, tagline and tags case-insensitively", async () => {
    await repo.insert(mk("Alpha"));
    await repo.insert(mk("Beta", { tagline: "does GAMMA things" }));
    await repo.insert(mk("Delta", { tags: ["Epsilon"] }));
    expect((await repo.list({ q: "alpha" })).map((b) => b.name)).toEqual(["Alpha"]);
    expect((await repo.list({ q: "gamma" })).map((b) => b.name)).toEqual(["Beta"]);
    expect((await repo.list({ q: "EPSILON" })).map((b) => b.name)).toEqual(["Delta"]);
    expect(await repo.count({ q: "epsilon" })).toBe(1);
  });

  it("filters by category and featured, paginates", async () => {
    await repo.insert(mk("A", { category: "sales" }));
    tick();
    await repo.insert(mk("B"));
    await repo.setFeatured("b", true);
    expect((await repo.list({ category: "sales" })).map((b) => b.name)).toEqual(["A"]);
    expect((await repo.list({ featured: true })).map((b) => b.name)).toEqual(["B"]);
    expect((await repo.list({ limit: 1, offset: 1 })).map((b) => b.name)).toEqual(["A"]);
  });

  it("sorts by installs and upvotes", async () => {
    await repo.insert(mk("A"));
    await repo.insert(mk("B"));
    await repo.recordEvent("b", "install", "h1");
    await repo.recordEvent("a", "upvote", "h1");
    await repo.recordEvent("a", "upvote", "h2");
    expect((await repo.list({ sort: "installs" }))[0]?.name).toBe("B");
    expect((await repo.list({ sort: "top" }))[0]?.name).toBe("A");
  });

  it("recordEvent is true once per hash/day", async () => {
    await repo.insert(mk("A"));
    expect(await repo.recordEvent("a", "install", "h")).toBe(true);
    expect(await repo.recordEvent("a", "install", "h")).toBe(false);
    expect((await repo.get("a"))?.installClicks).toBe(1);
    expect(await repo.recordEvent("a", "upvote", "h")).toBe(true);
    expect((await repo.get("a"))?.upvotes).toBe(1);
    clock = new Date("2026-01-02T00:00:00.000Z");
    expect(await repo.recordEvent("a", "install", "h")).toBe(true);
    expect((await repo.get("a"))?.installClicks).toBe(2);
  });

  it("categoryCounts counts published only with zeros", async () => {
    await repo.insert(mk("A", { category: "sales" }));
    await repo.insert(mk("B", { category: "sales" }));
    await repo.insert(mk("C", { category: "design", status: "pending" }));
    const c = await repo.categoryCounts();
    expect(c.sales).toBe(2);
    expect(c.design).toBe(0);
    expect(c["recruiting-people"]).toBe(0);
  });

  it("update, setStatus, delete", async () => {
    await repo.insert(mk("A"));
    tick();
    const u = await repo.update("a", { name: "A2", tags: ["z"], slug: "hack" });
    expect(u?.name).toBe("A2");
    expect(u?.slug).toBe("a");
    expect(u?.tags).toEqual(["z"]);
    expect(u?.updatedAt).toBe("2026-01-01T00:00:01.000Z");
    expect(await repo.update("zzz", { name: "x" })).toBeNull();
    await repo.setStatus("a", "pending");
    expect((await repo.get("a"))?.status).toBe("pending");
    expect(await repo.delete("a")).toBe(true);
    expect(await repo.delete("a")).toBe(false);
  });

  it("upsertFromCatalog updates existing slug and keeps counters", async () => {
    await repo.insert(mk("A", { slug: "cat" }));
    await repo.recordEvent("cat", "install", "h");
    const u = await repo.upsertFromCatalog({ ...mk("Renamed"), slug: "cat" });
    expect(u.slug).toBe("cat");
    expect(u.name).toBe("Renamed");
    expect(u.installClicks).toBe(1);
    const n = await repo.upsertFromCatalog({ ...mk("N"), slug: "fresh" });
    expect(n.slug).toBe("fresh");
  });

  it("counts concurrent events from different visitors without interleaving", async () => {
    await repo.insert(mk("Busy"));
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => repo.recordEvent("busy", "upvote", `visitor-${i}`)),
    );
    expect(results.every(Boolean)).toBe(true);
    expect((await repo.get("busy"))!.upvotes).toBe(25);
  });
  it("ignores a repeat event from the same visitor on the same day", async () => {
    await repo.insert(mk("Once"));
    expect(await repo.recordEvent("once", "upvote", "v1")).toBe(true);
    expect(await repo.recordEvent("once", "upvote", "v1")).toBe(false);
    expect((await repo.get("once"))!.upvotes).toBe(1);
  });
  it("treats %, _ and \\ in search text literally", async () => {
    await repo.insert(mk("100% done"));
    await repo.insert(mk("under_score"));
    await repo.insert(mk("back\\slash"));
    await repo.insert(mk("plain"));
    expect((await repo.list({ q: "100%" })).map((b) => b.name)).toEqual(["100% done"]);
    expect((await repo.list({ q: "r_s" })).map((b) => b.name)).toEqual(["under_score"]);
    expect((await repo.list({ q: "k\\s" })).map((b) => b.name)).toEqual(["back\\slash"]);
    expect(await repo.count({ q: "%" })).toBe(1);
  });
  it("keeps insertion order as the tiebreaker for equal timestamps", async () => {
    await repo.insert(mk("First")); await repo.insert(mk("Second")); await repo.insert(mk("Third"));
    expect((await repo.list({ sort: "new" })).map((b) => b.slug)).toEqual(["third", "second", "first"]);
  });

  describe("fixes", () => {
    it("recordEvent on unknown slug returns false and stores nothing", async () => {
      expect(await repo.recordEvent("ghost", "install", "h")).toBe(false);
      await repo.insert(mk("Ghost"));
      expect(await repo.recordEvent("ghost", "install", "h")).toBe(true);
    });

    it("delete removes events so a re-created slug can be counted again", async () => {
      await repo.insert(mk("A"));
      await repo.recordEvent("a", "install", "h");
      await repo.delete("a");
      await repo.insert(mk("A"));
      expect(await repo.recordEvent("a", "install", "h")).toBe(true);
      expect((await repo.get("a"))?.installClicks).toBe(1);
    });

    it("upsertFromCatalog preserves status and featured when unspecified", async () => {
      await repo.insert(mk("A", { slug: "cat" }));
      await repo.setStatus("cat", "pending");
      await repo.setFeatured("cat", true);
      const u = await repo.upsertFromCatalog({ ...mk("A2"), slug: "cat" });
      expect(u.status).toBe("pending");
      expect(u.featured).toBe(true);
      expect(u.name).toBe("A2");
      const n = await repo.upsertFromCatalog({ ...mk("New"), slug: "new" });
      expect(n.status).toBe("published");
      expect(n.featured).toBe(false);
    });

    it("q treats % and _ literally; empty slug is generated; limit is clamped", async () => {
      await repo.insert(mk("100% real"));
      await repo.insert(mk("other"));
      expect((await repo.list({ q: "%" })).map((b) => b.name)).toEqual(["100% real"]);
      expect(await repo.list({ q: "_" })).toEqual([]);
      expect((await repo.insert(mk("Zed", { slug: "" }))).slug).toBe("zed");
      expect(await repo.list({ limit: 0, offset: -5 })).toHaveLength(1);
    });
  });
});

describe("visitorHash", () => {
  it("is stable per day and differs by day", () => {
    const d1 = new Date("2026-01-01T10:00:00Z");
    const d2 = new Date("2026-01-02T10:00:00Z");
    expect(visitorHash("1.1.1.1", "s", d1)).toMatch(/^[0-9a-f]{64}$/);
    expect(visitorHash("1.1.1.1", "s", d1)).toBe(visitorHash("1.1.1.1", "s", new Date("2026-01-01T23:00:00Z")));
    expect(visitorHash("1.1.1.1", "s", d1)).not.toBe(visitorHash("1.1.1.1", "s", d2));
    expect(visitorHash("1.1.1.1", "s", d1)).not.toBe(visitorHash("1.1.1.2", "s", d1));
  });
});
