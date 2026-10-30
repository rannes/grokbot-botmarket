import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { RateLimiter } from "../src/core/rate-limit.js";
import { parseRecipe, type Recipe } from "../src/core/recipe.js";
import { BotsRepo, type NewBot } from "../src/db/bots-repo.js";
import { openDatabase } from "../src/db/database.js";
import type { AppDeps } from "../src/deps.js";

const ID = "AbCdEfGhIjKlMnOpQrStU";

function recipe(): Recipe {
  const r = parseRecipe({
    profile: { name: "Notes Keeper", description: "Keeps notes", avatarShape: "capsule", avatarColor: "teal" },
    memory: ["We ship on Thursdays."],
    skills: [{ name: "summarize-week", description: "Weekly summary", content: "# Steps\nSummarize the week." }],
  });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.recipe;
}

function mk(name: string, extra: Partial<NewBot> = {}): NewBot {
  return {
    name,
    tagline: `${name} tagline`,
    descriptionMd: "It helps.",
    category: "engineering",
    tags: ["release"],
    authorName: "Ann Author",
    authorUrl: null,
    avatarShape: "pebble",
    avatarColor: "magenta",
    imageUrl: null,
    templateId: ID,
    recipe: null,
    sourceUrl: null,
    homepageUrl: null,
    ...extra,
  };
}

let repo: BotsRepo;
let config: Config;

function app(over: Partial<AppDeps> = {}) {
  return createApp({ repo, config, salt: "test", ...over });
}
const ip = (v: string) => ({ "x-forwarded-for": v });
const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

beforeEach(() => {
  repo = new BotsRepo(openDatabase(":memory:"));
  config = { ...loadConfig({ BOTMARKET_SITE_NAME: "Test Market" }), trustProxy: true, publicUrl: "https://market.example" };
  repo.insert(mk("Release Notes Bot"));
  repo.insert(mk("Recipe Bot", { templateId: null, recipe: recipe(), category: "sales" }));
  repo.insert(mk("Pending Bot", { status: "pending" }));
});

describe("GET /add/:slug", () => {
  it("redirects template bots to the deep link and counts one install per visitor", async () => {
    const res = await app().request("/add/release-notes-bot", { headers: ip("1.1.1.1") });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`grokbot://app/v1/bot-template?id=${ID}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await app().request("/add/release-notes-bot", { headers: ip("1.1.1.1") });
    expect(repo.get("release-notes-bot")?.installClicks).toBe(1);
    await app().request("/add/release-notes-bot", { headers: ip("2.2.2.2") });
    expect(repo.get("release-notes-bot")?.installClicks).toBe(2);
  });

  it("?via=web goes to the x.ai page", async () => {
    const res = await app().request("/add/release-notes-bot?via=web");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://x.ai/bot/${ID}`);
  });

  it("recipe bots redirect to a prompt deep link containing the recipe url", async () => {
    const res = await app().request("/add/recipe-bot?via=web");
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc.startsWith("grokbot://app/v1/prompt?text=")).toBe(true);
    expect(decodeURIComponent(loc.split("text=")[1] ?? "")).toContain("https://market.example/api/bots/recipe-bot/recipe.json");
  });

  it("does not redirect for pending or unknown bots", async () => {
    for (const slug of ["pending-bot", "nope"]) {
      const res = await app().request(`/add/${slug}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).toBeNull();
      expect(await res.json()).toEqual({ error: "not found" });
    }
    expect(repo.get("pending-bot")?.installClicks).toBe(0);
  });
});

describe("GET /badge/:slug.svg", () => {
  it("serves an svg badge", async () => {
    const res = await app().request("/badge/release-notes-bot.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Add to Grok Bot");
  });
  it("404s for unknown and pending", async () => {
    expect((await app().request("/badge/nope.svg")).status).toBe(404);
    expect((await app().request("/badge/pending-bot.svg")).status).toBe(404);
  });
});

describe("GET /api/bots", () => {
  it("lists published bots with total", async () => {
    const body = (await (await app().request("/api/bots")).json()) as { bots: { slug: string }[]; total: number };
    expect(body.total).toBe(2);
    expect(body.bots.map((b) => b.slug).sort()).toEqual(["recipe-bot", "release-notes-bot"]);
  });
  it("filters by category, q and rejects bad category", async () => {
    const body = (await (await app().request("/api/bots?category=sales")).json()) as { bots: { slug: string }[]; total: number };
    expect(body.bots.map((b) => b.slug)).toEqual(["recipe-bot"]);
    expect(body.total).toBe(1);
    const q = (await (await app().request("/api/bots?q=recipe")).json()) as { total: number };
    expect(q.total).toBe(1);
    const bad = await app().request("/api/bots?category=bogus");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toHaveProperty("error");
  });
  it("clamps limit and honours offset", async () => {
    const big = (await (await app().request("/api/bots?limit=1000")).json()) as { bots: unknown[] };
    expect(big.bots).toHaveLength(2);
    const one = (await (await app().request("/api/bots?limit=1&offset=1")).json()) as { bots: unknown[]; total: number };
    expect(one.bots).toHaveLength(1);
    expect(one.total).toBe(2);
  });
});

describe("GET /api/bots/:slug", () => {
  it("returns a catalog bot or 404", async () => {
    const res = await app().request("/api/bots/release-notes-bot");
    expect(res.status).toBe(200);
    const b = (await res.json()) as { slug: string; installUrl: string };
    expect(b.slug).toBe("release-notes-bot");
    expect(b.installUrl).toBe(`grokbot://app/v1/bot-template?id=${ID}`);
    expect((await app().request("/api/bots/nope")).status).toBe(404);
    expect((await app().request("/api/bots/pending-bot")).status).toBe(404);
  });
  it("serves recipe.json only for published recipe bots", async () => {
    const res = await app().request("/api/bots/recipe-bot/recipe.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('inline; filename="recipe-bot.recipe.json"');
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(recipe())));
    expect((await app().request("/api/bots/release-notes-bot/recipe.json")).status).toBe(404);
    expect((await app().request("/api/bots/nope/recipe.json")).status).toBe(404);
  });
});

describe("POST /api/bots", () => {
  const base = { name: "Api Bot", tagline: "Made via API.", category: "sales", authorName: "Sam" };
  it("accepts a recipe-only submission", async () => {
    const res = await app().request("/api/bots", post({ ...base, recipe: recipe() }));
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/bots/api-bot");
    const b = (await res.json()) as { slug: string; status: string };
    expect(b.slug).toBe("api-bot");
    expect(b.status).toBe("published");
  });
  it("accepts a templateRef", async () => {
    const res = await app().request("/api/bots", post({ ...base, templateRef: `https://x.ai/bot/${ID}` }));
    expect(res.status).toBe(201);
  });
  it("is pending when approval is required", async () => {
    const res = await app({ config: { ...config, requireApproval: true } }).request("/api/bots", post({ ...base, templateRef: ID }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe("pending");
    expect(repo.get("api-bot")?.status).toBe("pending");
  });
  it("rejects with neither template nor recipe", async () => {
    const res = await app().request("/api/bots", post(base));
    expect(res.status).toBe(400);
    expect(Array.isArray(((await res.json()) as { errors: string[] }).errors)).toBe(true);
  });
  it("rejects invalid JSON", async () => {
    const res = await app().request("/api/bots", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(res.status).toBe(400);
  });
  it("rejects bodies over 6 MB with 413 before parsing", async () => {
    const res = await app().request("/api/bots", post({ ...base, templateRef: ID, descriptionMd: "x".repeat(7 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload too large" });
    expect(repo.get("api-bot")).toBeNull();
  });
  it("caps an object recipe at 2 MB", async () => {
    const big = { profile: { name: "Big" }, memory: ["m".repeat(3 * 1024 * 1024)] };
    const res = await app().request("/api/bots", post({ ...base, recipe: big }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toContain("recipe: must be at most 2 MB");
    expect(repo.get("api-bot")).toBeNull();
  });
  it("rate limits", async () => {
    const a = app({ submitLimiter: new RateLimiter(1, 60000) });
    expect((await a.request("/api/bots", post({ ...base, templateRef: ID }, ip("9.9.9.9")))).status).toBe(201);
    const res = await a.request("/api/bots", post({ ...base, name: "Other", templateRef: ID }, ip("9.9.9.9")));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate limited" });
  });
});

describe("POST /api/bots/:slug/upvote", () => {
  it("counts once per visitor", async () => {
    const r1 = await app().request("/api/bots/release-notes-bot/upvote", { method: "POST", headers: ip("3.3.3.3") });
    expect(await r1.json()).toEqual({ upvotes: 1, counted: true });
    const r2 = await app().request("/api/bots/release-notes-bot/upvote", { method: "POST", headers: ip("3.3.3.3") });
    expect(await r2.json()).toEqual({ upvotes: 1, counted: false });
  });
  it("404s unless published", async () => {
    expect((await app().request("/api/bots/pending-bot/upvote", { method: "POST" })).status).toBe(404);
    expect((await app().request("/api/bots/nope/upvote", { method: "POST" })).status).toBe(404);
  });
});

describe("catalog and health", () => {
  it("exports the catalog", async () => {
    const res = await app().request("/catalog.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const c = (await res.json()) as { format: string; site: { name: string; url: string }; bots: { slug: string }[] };
    expect(c.format).toBe("botmarket-catalog/v1");
    expect(c.site).toEqual({ name: "Test Market", url: "https://market.example" });
    expect(c.bots.map((b) => b.slug).sort()).toEqual(["recipe-bot", "release-notes-bot"]);
  });
  it("includes more than 100 bots", async () => {
    for (let i = 0; i < 105; i++) repo.insert(mk(`Bulk ${i}`));
    const c = (await (await app().request("/catalog.json")).json()) as { bots: unknown[] };
    expect(c.bots).toHaveLength(107);
  });
  it("healthz", async () => {
    const res = await app().request("/healthz");
    expect(await res.json()).toEqual({ ok: true });
  });
});
