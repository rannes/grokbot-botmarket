import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { RateLimiter } from "../src/core/rate-limit.js";
import { signAdminCookie } from "../src/core/admin-auth.js";
import { BotsRepo, type NewBot } from "../src/db/bots-repo.js";
import { openSqliteDatabase } from "../src/db/sqlite.js";
import { adminRoutes } from "../src/routes/admin.js";
import { Hono } from "hono";

const ID = "AbCdEfGhIjKlMnOpQrStU";
const TOKEN = "s3cret-token";
const SALT = "test-salt";

function mk(name: string, extra: Partial<NewBot> = {}): NewBot {
  return {
    name,
    tagline: `${name} tagline`,
    descriptionMd: "Does things.",
    category: "engineering",
    tags: ["a"],
    authorName: "Ann",
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
let pendingSlug: string;
let liveSlug: string;

function app(adminToken: string | null = TOKEN, fetchImpl?: typeof fetch) {
  const config = { ...loadConfig({ BOTMARKET_SITE_NAME: "Test Market" }), adminToken };
  const deps = { repo, config, salt: SALT };
  if (!fetchImpl) return createApp(deps);
  const a = new Hono();
  a.route("/", adminRoutes(deps, fetchImpl));
  return a;
}

const cookie = () => ({ cookie: `bm_admin=${signAdminCookie(TOKEN, SALT)}` });
const bearer = { authorization: `Bearer ${TOKEN}` };
const post = (headers: Record<string, string>, body?: Record<string, string>): RequestInit => ({
  method: "POST",
  headers,
  body: body ? new URLSearchParams(body) : undefined,
});

function catalog(n: number) {
  return {
    format: "botmarket-catalog/v1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    site: { name: "Other", url: null },
    bots: Array.from({ length: n }, (_, i) => ({
      slug: `imp-${i}`,
      name: `Imported ${i}`,
      tagline: "t",
      descriptionMd: "d",
      category: "engineering",
      tags: [],
      authorName: "Zed",
      authorUrl: null,
      avatarShape: null,
      avatarColor: null,
      imageUrl: null,
      templateId: ID,
      recipe: null,
      sourceUrl: null,
      homepageUrl: null,
    })),
  };
}
const fakeFetch = (body: string, ok = true) =>
  (async () => new Response(body, { status: ok ? 200 : 500 })) as unknown as typeof fetch;

beforeEach(async () => {
  repo = new BotsRepo(await openSqliteDatabase(":memory:"));
  pendingSlug = (await repo.insert(mk("Pending Bot", { status: "pending" }))).slug;
  liveSlug = (await repo.insert(mk("Live Bot", { status: "published" }))).slug;
});

describe("admin", () => {
  it("404s without a configured token", async () => {
    expect((await app(null).request("/admin")).status).toBe(404);
    expect((await app(null).request("/admin/export")).status).toBe(404);
  });

  it("shows login page", async () => {
    const res = await app().request("/admin");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="token"');
  });

  it("rejects wrong token and sets cookie for right one", async () => {
    const bad = await app().request("/admin/login", post({}, { token: "nope" }));
    expect(bad.status).toBe(401);
    const ok = await app().request("/admin/login", post({}, { token: TOKEN }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/admin");
    const sc = ok.headers.get("set-cookie") ?? "";
    expect(sc).toContain(`bm_admin=${signAdminCookie(TOKEN, SALT)}`);
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("SameSite=Lax");
  });

  it("accepts login behind an HTTPS proxy when publicUrl names the origin", async () => {
    const config = {
      ...loadConfig({ BOTMARKET_SITE_NAME: "Test Market" }),
      adminToken: TOKEN,
      publicUrl: "https://bots.example",
      trustProxy: false,
    };
    const a = createApp({ repo, config, salt: SALT });
    // the proxy forwards to http://localhost; the browser sends the public origin
    const ok = await a.request("http://localhost/admin/login", post({ origin: "https://bots.example" }, { token: TOKEN }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("set-cookie") ?? "").toContain("Secure");
    const evil = await a.request("http://localhost/admin/login", post({ origin: "https://evil.example" }, { token: TOKEN }));
    expect(evil.status).toBe(403);
  });

  it("rate limits login attempts per IP", async () => {
    const a = app();
    for (let i = 0; i < 10; i++) {
      expect((await a.request("/admin/login", post({}, { token: `wrong-${i}` }))).status).toBe(401);
    }
    const limited = await a.request("/admin/login", post({}, { token: TOKEN }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("set-cookie")).toBeNull();
    const html = await limited.text();
    expect(html).toContain("Too many login attempts");
    expect(html).toContain('name="token"');
  });

  it("dashboard lists pending bots with cookie", async () => {
    const res = await app().request("/admin", { headers: cookie() });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Pending Bot");
    expect(html).toContain("Live Bot");
    expect(html).toContain(`/admin/bots/${pendingSlug}/approve`);
  });

  it("previews pending bots for admins only", async () => {
    const a = app();
    const dash = await (await a.request("/admin", { headers: cookie() })).text();
    const link = `/admin/bots/${pendingSlug}`;
    expect(dash).toContain(`href="${link}"`);
    const res = await a.request(link, { headers: cookie() });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Pending Bot");
    expect(html).toContain("Pending — preview");
    expect(html).toContain(`${link}/approve`);
    const live = await a.request(`/admin/bots/${liveSlug}`, { headers: cookie() });
    expect(live.status).toBe(200);
    expect(await live.text()).not.toContain("Pending — preview");
    expect((await a.request(link)).status).toBe(401);
    expect((await a.request("/admin/bots/nope", { headers: cookie() })).status).toBe(404);
    // public routes stay published-only
    expect((await a.request(`/bots/${pendingSlug}`)).status).toBe(404);
  });

  it("requires admin for actions", async () => {
    const res = await app().request(`/admin/bots/${pendingSlug}/approve`, post({}));
    expect(res.status).toBe(401);
    expect((await repo.get(pendingSlug))?.status).toBe("pending");
  });

  it("approves, features, unfeatures and deletes via Bearer", async () => {
    const a = app();
    let res = await a.request(`/admin/bots/${pendingSlug}/approve`, post(bearer));
    expect(res.status).toBe(303);
    expect((await repo.get(pendingSlug))?.status).toBe("published");
    await a.request(`/admin/bots/${liveSlug}/feature`, post(bearer));
    expect((await repo.get(liveSlug))?.featured).toBe(true);
    await a.request(`/admin/bots/${liveSlug}/unfeature`, post(bearer));
    expect((await repo.get(liveSlug))?.featured).toBe(false);
    res = await a.request(`/admin/bots/${liveSlug}/delete`, post(bearer));
    expect(res.status).toBe(303);
    expect(await repo.get(liveSlug)).toBeNull();
  });

  it("404s unknown slug", async () => {
    const res = await app().request("/admin/bots/nope/approve", post(bearer));
    expect(res.status).toBe(404);
  });

  it("imports a catalog through the injected fetch", async () => {
    const a = app(TOKEN, fakeFetch(JSON.stringify(catalog(2))));
    const res = await a.request("/admin/import", post(cookie(), { url: "https://other.example/catalog.json" }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Imported 2");
    expect(html).toContain("2 new");
    expect(await repo.get("imp-0")).not.toBeNull();
    expect(await repo.get("imp-1")).not.toBeNull();
    const again = await a.request("/admin/import", post(bearer, { url: "https://other.example/catalog.json" }));
    expect(await again.text()).toContain("2 updated");
  });

  it("rejects non-https import urls and bad catalogs", async () => {
    const a = app(TOKEN, fakeFetch("{}"));
    expect((await a.request("/admin/import", post(cookie(), { url: "http://x.example/c.json" }))).status).toBe(400);
    const bad = await a.request("/admin/import", post(cookie(), { url: "https://x.example/c.json" }));
    expect(bad.status).toBe(400);
  });

  it("blocks cross-site posts with cookie auth", async () => {
    const res = await app().request(
      `/admin/bots/${pendingSlug}/approve`,
      post({ ...cookie(), "sec-fetch-site": "cross-site" }),
    );
    expect(res.status).toBe(403);
    const res2 = await app().request(
      `/admin/bots/${pendingSlug}/approve`,
      post({ ...cookie(), origin: "https://evil.example" }),
    );
    expect(res2.status).toBe(403);
    expect((await repo.get(pendingSlug))?.status).toBe("pending");
  });

  it("redirects export to catalog.json", async () => {
    const res = await app().request("/admin/export", { headers: cookie() });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/catalog.json");
  });

  it("rejects forged cookies and wrong bearer tokens", async () => {
    const a = app();
    expect((await a.request("/admin")).status).toBe(200);
    const forged = await a.request(`/admin/bots/${pendingSlug}/approve`, post({ cookie: "bm_admin=deadbeef" }));
    expect(forged.status).toBe(401);
    const wrong = await a.request(`/admin/bots/${pendingSlug}/approve`, post({ authorization: "Bearer nope" }));
    expect(wrong.status).toBe(401);
    expect((await repo.get(pendingSlug))?.status).toBe("pending");
  });

  it("refuses redirects and surfaces fetch errors on import", async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i?: RequestInit) => {
      init = i;
      throw new TypeError("redirect mode is set to error");
    }) as unknown as typeof fetch;
    const res = await app(TOKEN, f).request("/admin/import", post(cookie(), { url: "https://x.example/c.json" }));
    expect(res.status).toBe(400);
    expect(init?.redirect).toBe("error");
  });
});

describe("admin Bearer brute-force limiting", () => {
  it("rate limits wrong Bearer tokens but not valid ones", async () => {
    const config = { ...loadConfig({ BOTMARKET_SITE_NAME: "Test Market" }), adminToken: TOKEN };
    const a = createApp({ repo, config, salt: SALT, loginLimiter: new RateLimiter(3, 60_000) });
    const wrong = { authorization: "Bearer nope" };
    for (let i = 0; i < 3; i++) {
      const r = await a.request("/admin", { headers: wrong });
      expect(r.status).toBe(200);
      expect(await r.text()).not.toContain("Pending");
    }
    const blocked = await a.request("/admin", { headers: wrong });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate limited" });
    const good = await a.request("/admin", { headers: bearer });
    expect(good.status).toBe(200);
  });
});
