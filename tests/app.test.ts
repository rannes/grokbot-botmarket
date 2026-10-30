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
    skills: [{ name: "summarize-week", description: "Weekly summary", content: "# Steps\nSummarize <b>the</b> week." }],
    routines: [{ name: "Friday digest", content: "Send digest", schedule: "0 9 * * 5", timezone: "Europe/Tallinn" }],
    plugins: [{ pluginId: "123", name: "GitHub", description: "Reads PRs" }],
  });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.recipe;
}

function mk(name: string, extra: Partial<NewBot> = {}): NewBot {
  return {
    name,
    tagline: `${name} tagline`,
    descriptionMd: "## What it does\n\nIt **helps**.",
    category: "engineering",
    tags: ["release", "notes"],
    authorName: "Ann Author",
    authorUrl: "https://ann.example",
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

function form(fields: Record<string, string>): RequestInit {
  return { method: "POST", body: new URLSearchParams(fields) };
}

const validSubmission = {
  ref: `https://x.ai/bot/${ID}`,
  recipeText: "",
  name: "Sales Scout",
  tagline: "Finds leads while you sleep.",
  category: "sales",
  tags: "leads, Prospecting",
  authorName: "Sam",
  authorUrl: "",
  descriptionMd: "Scouts **leads**.",
  imageUrl: "",
  sourceUrl: "",
  homepageUrl: "",
  avatarShape: "",
  avatarColor: "",
};

beforeEach(() => {
  repo = new BotsRepo(openDatabase(":memory:"));
  config = { ...loadConfig({ BOTMARKET_SITE_NAME: "Test Market" }), publicUrl: "https://market.example" };
  repo.insert(mk("Release Notes Bot", { featured: true }));
});

describe("security and static", () => {
  it("sets security headers on pages", async () => {
    const res = await app().request("/");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("img-src 'self' https: data:");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("serves the stylesheet and script", async () => {
    const css = await app().request("/static/styles.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(css.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await css.text()).toContain(".av-magenta");
    const js = await app().request("/static/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(await js.text()).toContain("data-copy");
  });

  it("serves the default og image as a 1200x630 PNG", async () => {
    const res = await app().request("/static/og-default.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(buf.toString("ascii", 12, 16)).toBe("IHDR");
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });

  it("renders a 404 page for unknown routes", async () => {
    const res = await app().request("/nope/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Test Market");
  });

  it("never emits inline style or event handler attributes", async () => {
    repo.insert(mk("Recipe Bot", { templateId: null, recipe: recipe() }));
    for (const path of ["/", "/bots/release-notes-bot", "/bots/recipe-bot", "/submit", "/c/engineering", "/search?q=x"]) {
      const html = await (await app().request(path)).text();
      expect(html, path).not.toMatch(/\sstyle=/);
      expect(html, path).not.toMatch(/\son[a-z]+=/);
      expect(html, path).not.toMatch(/<script(?![^>]*\bsrc=)/);
    }
  });
});

describe("home", () => {
  it("lists published bots with site name, featured row and add links", async () => {
    repo.insert(mk("Hidden Pending Bot", { status: "pending" }));
    const res = await app().request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Test Market");
    expect(html).toContain("Release Notes Bot");
    expect(html).toContain('href="/add/release-notes-bot"');
    expect(html).toContain("Featured");
    expect(html).toContain('href="/c/engineering"');
    expect(html).toContain('action="/search"');
    expect(html).not.toContain("Hidden Pending Bot");
    expect(html).toContain('href="/static/styles.css"');
    expect(html).toContain('src="/static/app.js"');
    expect(html).toContain("Not affiliated with xAI or Cursor.");
  });

  it("shows an empty state with no bots", async () => {
    repo = new BotsRepo(openDatabase(":memory:"));
    const html = await (await app().request("/")).text();
    expect(html).toContain('href="/submit"');
    expect(html).toContain("No bots yet");
    expect(html).not.toContain("Featured");
    expect(html).not.toContain('class="chips"');
  });
});

describe("bot detail", () => {
  it("shows template install buttons and og tags", async () => {
    repo.update("release-notes-bot", { imageUrl: "https://img.example/a.png" });
    const res = await app().request("/bots/release-notes-bot");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`href="grokbot://app/v1/bot-template?id=${ID}"`);
    expect(html).toContain(`href="https://cursor.com/grok-bot/link/v1/bot-template?id=${ID}"`);
    expect(html).toContain(`href="https://x.ai/bot/${ID}"`);
    expect(html).toContain('href="/add/release-notes-bot"');
    expect(html).toContain("Add to Grok Bot");
    expect(html).toContain('<meta property="og:url" content="https://market.example/bots/release-notes-bot"');
    expect(html).toContain('<meta property="og:title" content="Release Notes Bot"');
    expect(html).toContain('<meta property="og:image" content="https://img.example/a.png"');
    expect(html).toContain('content="summary_large_image"');
    expect(html).toContain('<meta property="og:type" content="website"');
    expect(html).toContain("<strong>helps</strong>");
    expect(html).toContain('href="https://ann.example"');
    expect(html).toContain(
      "[![Add to Grok Bot](https://market.example/badge/release-notes-bot.svg)](https://market.example/add/release-notes-bot)",
    );
    expect(html).toContain("Nothing is added until you confirm inside Grok Bot.");
  });

  it("falls back to the default og:image without an image", async () => {
    const html = await (await app().request("/bots/release-notes-bot")).text();
    expect(html).toContain('<meta property="og:image" content="https://market.example/static/og-default.png"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    const home = await (await app().request("/")).text();
    expect(home).toContain('<meta property="og:image" content="https://market.example/static/og-default.png"');
    expect(home).toContain('<meta property="og:type" content="website"');
  });

  it("404s for unknown and pending bots", async () => {
    repo.insert(mk("Pending Bot", { status: "pending" }));
    expect((await app().request("/bots/nope")).status).toBe(404);
    expect((await app().request("/bots/pending-bot")).status).toBe(404);
  });

  it("shows recipe install options and recipe contents", async () => {
    repo.insert(mk("Recipe Bot", { templateId: null, recipe: recipe() }));
    const html = await (await app().request("/bots/recipe-bot")).text();
    expect(html).toContain("Create in Grok Bot");
    expect(html).toContain('href="/add/recipe-bot"');
    expect(html).toContain('href="/api/bots/recipe-bot/recipe.json"');
    expect(html).toContain("Copy setup prompt");
    expect(html).toContain("https://market.example/api/bots/recipe-bot/recipe.json");
    expect(html).not.toContain("grokbot://app/v1/bot-template");
    expect(html).toContain("We ship on Thursdays.");
    expect(html).toContain("summarize-week");
    expect(html).toContain("Summarize &lt;b&gt;the&lt;/b&gt; week.");
    expect(html).toContain("Friday digest");
    expect(html).toContain("0 9 * * 5");
    expect(html).toContain("Europe/Tallinn");
    expect(html).toContain("GitHub");
  });

  it("escapes user-provided text", async () => {
    repo.insert(mk("<script>alert(1)</script>", { slug: "xss", tagline: '"><img src=x>' }));
    const html = await (await app().request("/bots/xss")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain('"><img src=x>');
  });

  it("ignores forwarded headers for the origin by default", async () => {
    config = { ...config, publicUrl: null };
    const html = await (
      await app().request("/bots/release-notes-bot", {
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": "evil.example" },
      })
    ).text();
    expect(html).not.toContain("evil.example");
    expect(html).toContain('<meta property="og:url" content="http://localhost/bots/release-notes-bot"');
  });

  it("uses forwarded headers for the origin when publicUrl is unset and trustProxy is on", async () => {
    config = { ...config, publicUrl: null, trustProxy: true };
    const html = await (
      await app().request("/bots/release-notes-bot", {
        headers: { "x-forwarded-proto": "https", "x-forwarded-host": "bots.example.org" },
      })
    ).text();
    expect(html).toContain('content="https://bots.example.org/bots/release-notes-bot"');
  });
});

describe("category and search", () => {
  it("filters by category and 404s unknown categories", async () => {
    repo.insert(mk("Lead Finder", { category: "sales" }));
    const res = await app().request("/c/sales");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Lead Finder");
    expect(html).not.toContain("Release Notes Bot");
    expect((await app().request("/c/nope")).status).toBe(404);
  });

  it("searches and shows a count or an empty state", async () => {
    repo.insert(mk("Lead Finder", { category: "sales", tags: ["crm"] }));
    const html = await (await app().request("/search?q=lead")).text();
    expect(html).toContain("Lead Finder");
    expect(html).not.toContain("Release Notes Bot");
    expect(html).toContain("1 bot matches");
    const none = await (await app().request("/search?q=zzzz")).text();
    expect(none).toContain("No bots match");
  });
});

describe("submit", () => {
  it("renders the form", async () => {
    const res = await app().request("/submit");
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const f of ["ref", "recipeText", "name", "tagline", "category", "tags", "authorName", "authorUrl", "descriptionMd", "imageUrl", "sourceUrl", "homepageUrl", "avatarShape", "avatarColor"]) {
      expect(html, f).toContain(`name="${f}"`);
    }
    expect(html).toContain('formaction="/submit/lookup"');
  });

  it("makes publish the default action when Enter is pressed in a field", async () => {
    const html = await (await app().request("/submit")).text();
    const formHtml = html.slice(html.indexOf('<form class="submit-form"'));
    const firstSubmit = /<button[^>]*type="submit"[^>]*>/.exec(formHtml)?.[0] ?? "";
    expect(firstSubmit).not.toContain("formaction");
  });

  it("lookup prefills fields from x.ai metadata", async () => {
    const seen: string[] = [];
    const fetchMetadata = async (id: string) => {
      seen.push(id);
      return {
        id,
        name: "Fetched Name",
        description: "D".repeat(300),
        avatarShape: "teardrop",
        avatarColor: "orange",
        imageUrl: "https://img.example/og.png",
        published: true,
      };
    };
    const res = await app({ fetchMetadata }).request("/submit/lookup", form({ ref: `https://x.ai/bot/${ID}`, authorName: "Kept Author" }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(seen).toEqual([ID]);
    expect(html).toContain('value="Fetched Name"');
    expect(html).toContain(`value="${"D".repeat(199)}…"`);
    expect(html).not.toContain(`value="${"D".repeat(201)}`);
    expect(html).toContain('value="teardrop"');
    expect(html).toContain('value="orange"');
    expect(html).toContain('value="https://img.example/og.png"');
    expect(html).toContain('value="Kept Author"');
    expect(html).toContain("av av-teardrop av-orange");
    expect(html).toContain(`value="https://x.ai/bot/${ID}"`);
  });

  it("lookup drops a non-https image URL from x.ai metadata", async () => {
    const fetchMetadata = async (id: string) => ({
      id,
      name: "Fetched Name",
      description: "",
      avatarShape: null,
      avatarColor: null,
      imageUrl: "http://insecure.example/og.png",
      published: true,
    });
    const html = await (await app({ fetchMetadata }).request("/submit/lookup", form({ ref: ID }))).text();
    expect(html).toContain('value="Fetched Name"');
    expect(html).not.toContain("insecure.example");
  });

  it("Fill in from recipe uses the recipe even when a template link is also filled", async () => {
    let called = false;
    const fetchMetadata = async () => ((called = true), null);
    const res = await app({ fetchMetadata }).request(
      "/submit/lookup",
      form({ ref: ID, lookup: "recipe", recipeText: JSON.stringify(recipe()) }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(called).toBe(false);
    expect(html).toContain('value="Notes Keeper"');
    expect(html).toContain("Filled in from the recipe");
    expect(html).toContain(`value="${ID}"`);
  });

  it("Look up uses the template link even when a recipe is also filled", async () => {
    const seen: string[] = [];
    const fetchMetadata = async (id: string) => (seen.push(id), null);
    await app({ fetchMetadata }).request(
      "/submit/lookup",
      form({ ref: ID, lookup: "template", recipeText: JSON.stringify(recipe()) }),
    );
    expect(seen).toEqual([ID]);
  });

  it("Fill in from recipe without a recipe asks for one", async () => {
    const res = await app().request("/submit/lookup", form({ ref: "", lookup: "recipe", recipeText: " " }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Paste a recipe first");
  });

  it("rate limits lookups per client IP and keeps the form values", async () => {
    let calls = 0;
    const fetchMetadata = async () => (calls++, null);
    const a = app({ fetchMetadata, lookupLimiter: new RateLimiter(1, 60_000) });
    expect((await a.request("/submit/lookup", form({ ref: ID }))).status).toBe(200);
    const res = await a.request("/submit/lookup", form({ ref: ID, authorName: "Kept Author" }));
    expect(res.status).toBe(429);
    const html = await res.text();
    expect(html).toContain("Too many lookups");
    expect(html).toContain('value="Kept Author"');
    expect(calls).toBe(1);
  });

  it("lookup failure renders the form with a warning", async () => {
    const res = await app({ fetchMetadata: async () => null }).request("/submit/lookup", form({ ref: ID }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Couldn’t fetch details from x.ai");
    expect(html).toContain(`value="${ID}"`);
  });

  it("lookup with an invalid ref re-renders with an error", async () => {
    let called = false;
    const res = await app({ fetchMetadata: async () => ((called = true), null) }).request("/submit/lookup", form({ ref: "https://example.com/x" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("not a Grok Bot template link or id");
    expect(called).toBe(false);
  });

  it("lookup fills fields from a pasted recipe", async () => {
    const res = await app().request(
      "/submit/lookup",
      form({ ref: "", lookup: "recipe", category: "sales", recipeText: JSON.stringify(recipe()) }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="Notes Keeper"');
    expect(html).toContain('value="Keeps notes"');
    expect(html).toContain('value="capsule"');
    expect(html).toContain('<option value="sales" selected="">');
    expect(html).toContain("Filled in from the recipe");
  });

  it("lookup reports recipe errors", async () => {
    const res = await app().request("/submit/lookup", form({ ref: "", recipeText: "{nope" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Recipe: not valid JSON");
  });

  it("creates a published bot and redirects to it", async () => {
    const res = await app().request("/submit", form(validSubmission));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/bots/sales-scout");
    const bot = repo.get("sales-scout");
    expect(bot?.status).toBe("published");
    expect(bot?.templateId).toBe(ID);
    expect(bot?.tags).toEqual(["leads", "prospecting"]);
    expect(bot?.category).toBe("sales");
  });

  it("redirects to the suffixed slug when the name is taken", async () => {
    const res = await app().request("/submit", form({ ...validSubmission, name: "Release Notes Bot" }));
    expect(res.headers.get("location")).toBe("/bots/release-notes-bot-2");
  });

  it("creates a recipe bot from pasted JSON", async () => {
    const res = await app().request(
      "/submit",
      form({ ...validSubmission, ref: "", name: "Recipe Only", recipeText: JSON.stringify(recipe()) }),
    );
    expect(res.status).toBe(303);
    const bot = repo.get("recipe-only");
    expect(bot?.templateId).toBeNull();
    expect(bot?.recipe?.skills[0]?.name).toBe("summarize-week");
    expect(bot?.avatarShape).toBe("capsule");
  });

  it("re-renders with errors and previous values on invalid input", async () => {
    const res = await app().request("/submit", form({ ...validSubmission, category: "nope" }));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Category: must be one of");
    expect(html).toContain('value="Sales Scout"');
    expect(repo.get("sales-scout")).toBeNull();
  });

  it("holds submissions for approval when required", async () => {
    config = { ...config, requireApproval: true };
    const res = await app().request("/submit", form(validSubmission));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/submitted");
    expect(repo.get("sales-scout")?.status).toBe("pending");
    const page = await app().request("/submitted");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("approv");
  });

  it("rate limits submissions per forwarded IP when trustProxy is on", async () => {
    config = { ...config, trustProxy: true };
    const a = app({ submitLimiter: new RateLimiter(1, 60_000) });
    const headers = { "x-forwarded-for": "203.0.113.9" };
    const first = await a.request("/submit", { ...form(validSubmission), headers });
    expect(first.status).toBe(303);
    const second = await a.request("/submit", { ...form({ ...validSubmission, name: "Another" }), headers });
    expect(second.status).toBe(429);
    const limited = await second.text();
    expect(limited).toContain("Too many submissions");
    expect(limited).toContain('value="Another"');
    expect(limited).toContain('<form class="submit-form"');
    expect(repo.get("another")).toBeNull();
    const other = await a.request("/submit", {
      ...form({ ...validSubmission, name: "Third" }),
      headers: { "x-forwarded-for": "198.51.100.1" },
    });
    expect(other.status).toBe(303);
  });

  it("keys on the last x-forwarded-for hop, which the proxy appended", async () => {
    config = { ...config, trustProxy: true };
    const a = app({ submitLimiter: new RateLimiter(1, 60_000) });
    const first = await a.request("/submit", { ...form(validSubmission), headers: { "x-forwarded-for": "1.1.1.1, 9.9.9.9" } });
    expect(first.status).toBe(303);
    // a client-chosen first hop does not buy a fresh budget
    const spoofed = await a.request("/submit", {
      ...form({ ...validSubmission, name: "Spoofed" }),
      headers: { "x-forwarded-for": "2.2.2.2, 9.9.9.9" },
    });
    expect(spoofed.status).toBe(429);
    const other = await a.request("/submit", {
      ...form({ ...validSubmission, name: "Other Hop" }),
      headers: { "x-forwarded-for": "1.1.1.1, 8.8.8.8" },
    });
    expect(other.status).toBe(303);
  });

  it("ignores x-forwarded-for by default and limits by socket address", async () => {
    const a = app({ submitLimiter: new RateLimiter(1, 60_000) });
    const first = await a.request("/submit", { ...form(validSubmission), headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(first.status).toBe(303);
    // a spoofed forwarded IP does not get a fresh budget
    const spoofed = await a.request("/submit", {
      ...form({ ...validSubmission, name: "Spoofed" }),
      headers: { "x-forwarded-for": "198.51.100.77" },
    });
    expect(spoofed.status).toBe(429);
    // a different socket address does
    const env = { incoming: { socket: { remoteAddress: "192.0.2.44" } } };
    const other = await a.request("/submit", form({ ...validSubmission, name: "Other Socket" }), env);
    expect(other.status).toBe(303);
  });
});
