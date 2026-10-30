import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { BotsRepo, type NewBot } from "../src/db/bots-repo.js";
import { visitorHash } from "../src/db/visitor.js";
import { exportCatalog, parseCatalog } from "../src/core/catalog.js";

let clock = new Date("2026-01-01T00:00:00.000Z");
let repo: BotsRepo;

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

beforeEach(() => {
  clock = new Date("2026-01-01T00:00:00.000Z");
  repo = new BotsRepo(openDatabase(":memory:"), () => clock);
});

const tick = () => (clock = new Date(clock.getTime() + 1000));

describe("BotsRepo", () => {
  it("round-trips recipe and tags", () => {
    const b = repo.insert(mk("Foo Bot", { recipe: { x: [1, 2], y: "z" }, tags: ["t1", "t2"] }));
    expect(b.slug).toBe("foo-bot");
    expect(b.status).toBe("published");
    expect(b.featured).toBe(false);
    expect(b.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(repo.get("foo-bot")).toEqual(b);
    expect(repo.get("foo-bot")?.recipe).toEqual({ x: [1, 2], y: "z" });
    expect(repo.get("foo-bot")?.tags).toEqual(["t1", "t2"]);
    expect(repo.get("nope")).toBeNull();
  });

  it("keeps suffixed slugs within 64 chars so the catalog re-imports", () => {
    const name = `${"a".repeat(61)} bc`; // slug: 61 a's + "-bc" = 64 chars
    const first = repo.insert(mk(name, { templateId: "AbCdEfGhIjKlMnOpQrStU" }));
    expect(first.slug).toHaveLength(64);
    const second = repo.insert(mk(name, { templateId: "AbCdEfGhIjKlMnOpQrStU" }));
    expect(second.slug).toBe(`${"a".repeat(61)}-2`);
    expect(second.slug.length).toBeLessThanOrEqual(64);
    const third = repo.insert(mk("b".repeat(64), { templateId: "AbCdEfGhIjKlMnOpQrStU" }));
    const fourth = repo.insert(mk("b".repeat(64), { templateId: "AbCdEfGhIjKlMnOpQrStU" }));
    expect(fourth.slug).toBe(`${"b".repeat(62)}-2`);
    const parsed = parseCatalog(JSON.parse(JSON.stringify(exportCatalog([first, second, third, fourth], { name: "T", url: null }))));
    expect(parsed.ok).toBe(true);
  });

  it("insert with duplicate slug gets a numeric suffix", () => {
    expect(repo.insert(mk("x", { slug: "foo" })).slug).toBe("foo");
    expect(repo.insert(mk("x", { slug: "foo" })).slug).toBe("foo-2");
    expect(repo.insert(mk("x", { slug: "foo" })).slug).toBe("foo-3");
  });

  it("list defaults to published, newest first", () => {
    repo.insert(mk("Old"));
    tick();
    repo.insert(mk("Pend", { status: "pending" }));
    tick();
    repo.insert(mk("New"));
    expect(repo.list().map((b) => b.name)).toEqual(["New", "Old"]);
    expect(repo.list({ status: "all" })).toHaveLength(3);
    expect(repo.list({ status: "pending" }).map((b) => b.name)).toEqual(["Pend"]);
    expect(repo.count()).toBe(2);
    expect(repo.count({ status: "all" })).toBe(3);
  });

  it("q matches name, tagline and tags case-insensitively", () => {
    repo.insert(mk("Alpha"));
    repo.insert(mk("Beta", { tagline: "does GAMMA things" }));
    repo.insert(mk("Delta", { tags: ["Epsilon"] }));
    expect(repo.list({ q: "alpha" }).map((b) => b.name)).toEqual(["Alpha"]);
    expect(repo.list({ q: "gamma" }).map((b) => b.name)).toEqual(["Beta"]);
    expect(repo.list({ q: "EPSILON" }).map((b) => b.name)).toEqual(["Delta"]);
    expect(repo.count({ q: "epsilon" })).toBe(1);
  });

  it("filters by category and featured, paginates", () => {
    repo.insert(mk("A", { category: "sales" }));
    tick();
    repo.insert(mk("B"));
    repo.setFeatured("b", true);
    expect(repo.list({ category: "sales" }).map((b) => b.name)).toEqual(["A"]);
    expect(repo.list({ featured: true }).map((b) => b.name)).toEqual(["B"]);
    expect(repo.list({ limit: 1, offset: 1 }).map((b) => b.name)).toEqual(["A"]);
  });

  it("sorts by installs and upvotes", () => {
    repo.insert(mk("A"));
    repo.insert(mk("B"));
    repo.recordEvent("b", "install", "h1");
    repo.recordEvent("a", "upvote", "h1");
    repo.recordEvent("a", "upvote", "h2");
    expect(repo.list({ sort: "installs" })[0]?.name).toBe("B");
    expect(repo.list({ sort: "top" })[0]?.name).toBe("A");
  });

  it("recordEvent is true once per hash/day", () => {
    repo.insert(mk("A"));
    expect(repo.recordEvent("a", "install", "h")).toBe(true);
    expect(repo.recordEvent("a", "install", "h")).toBe(false);
    expect(repo.get("a")?.installClicks).toBe(1);
    expect(repo.recordEvent("a", "upvote", "h")).toBe(true);
    expect(repo.get("a")?.upvotes).toBe(1);
    clock = new Date("2026-01-02T00:00:00.000Z");
    expect(repo.recordEvent("a", "install", "h")).toBe(true);
    expect(repo.get("a")?.installClicks).toBe(2);
  });

  it("categoryCounts counts published only with zeros", () => {
    repo.insert(mk("A", { category: "sales" }));
    repo.insert(mk("B", { category: "sales" }));
    repo.insert(mk("C", { category: "design", status: "pending" }));
    const c = repo.categoryCounts();
    expect(c.sales).toBe(2);
    expect(c.design).toBe(0);
    expect(c["recruiting-people"]).toBe(0);
  });

  it("update, setStatus, delete", () => {
    repo.insert(mk("A"));
    tick();
    const u = repo.update("a", { name: "A2", tags: ["z"], slug: "hack" });
    expect(u?.name).toBe("A2");
    expect(u?.slug).toBe("a");
    expect(u?.tags).toEqual(["z"]);
    expect(u?.updatedAt).toBe("2026-01-01T00:00:01.000Z");
    expect(repo.update("zzz", { name: "x" })).toBeNull();
    repo.setStatus("a", "pending");
    expect(repo.get("a")?.status).toBe("pending");
    expect(repo.delete("a")).toBe(true);
    expect(repo.delete("a")).toBe(false);
  });

  it("upsertFromCatalog updates existing slug and keeps counters", () => {
    repo.insert(mk("A", { slug: "cat" }));
    repo.recordEvent("cat", "install", "h");
    const u = repo.upsertFromCatalog({ ...mk("Renamed"), slug: "cat" });
    expect(u.slug).toBe("cat");
    expect(u.name).toBe("Renamed");
    expect(u.installClicks).toBe(1);
    const n = repo.upsertFromCatalog({ ...mk("N"), slug: "fresh" });
    expect(n.slug).toBe("fresh");
  });
});

describe("BotsRepo fixes", () => {
  it("recordEvent on unknown slug returns false and stores nothing", () => {
    expect(repo.recordEvent("ghost", "install", "h")).toBe(false);
    repo.insert(mk("Ghost"));
    expect(repo.recordEvent("ghost", "install", "h")).toBe(true);
  });

  it("delete removes events so a re-created slug can be counted again", () => {
    repo.insert(mk("A"));
    repo.recordEvent("a", "install", "h");
    repo.delete("a");
    repo.insert(mk("A"));
    expect(repo.recordEvent("a", "install", "h")).toBe(true);
    expect(repo.get("a")?.installClicks).toBe(1);
  });

  it("upsertFromCatalog preserves status and featured when unspecified", () => {
    repo.insert(mk("A", { slug: "cat" }));
    repo.setStatus("cat", "pending");
    repo.setFeatured("cat", true);
    const u = repo.upsertFromCatalog({ ...mk("A2"), slug: "cat" });
    expect(u.status).toBe("pending");
    expect(u.featured).toBe(true);
    expect(u.name).toBe("A2");
    const n = repo.upsertFromCatalog({ ...mk("New"), slug: "new" });
    expect(n.status).toBe("published");
    expect(n.featured).toBe(false);
  });

  it("q treats % and _ literally; empty slug is generated; limit is clamped", () => {
    repo.insert(mk("100% real"));
    repo.insert(mk("other"));
    expect(repo.list({ q: "%" }).map((b) => b.name)).toEqual(["100% real"]);
    expect(repo.list({ q: "_" })).toEqual([]);
    expect(repo.insert(mk("Zed", { slug: "" })).slug).toBe("zed");
    expect(repo.list({ limit: 0, offset: -5 })).toHaveLength(1);
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
