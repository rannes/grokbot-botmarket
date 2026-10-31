import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { BotsRepo } from "../src/db/bots-repo.js";
import { openSqliteDatabase } from "../src/db/sqlite.js";
import { VERSION } from "../src/version.js";

let repo: BotsRepo;
const config = loadConfig({});
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  repo = new BotsRepo(await openSqliteDatabase(":memory:"));
  app = createApp({ repo, config });
});

describe("status", () => {
  it("GET /api/status reports the driver and version", async () => {
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ version: VERSION, database: { driver: "sqlite", ok: true } });
  });

  it("GET /healthz reports the driver", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, database: { driver: "sqlite", ok: true } });
  });

  it("answers 503 when the database ping fails", async () => {
    const broken = Object.create(repo) as BotsRepo;
    broken.ping = () => Promise.reject(new Error("connection refused"));
    const app2 = createApp({ repo: broken, config });
    const status = await app2.request("/api/status");
    expect(status.status).toBe(503);
    const statusText = await status.text();
    expect(JSON.parse(statusText)).toEqual({ version: VERSION, database: { driver: "sqlite", ok: false } });
    expect(statusText).not.toContain("connection refused");
    const health = await app2.request("/healthz");
    expect(health.status).toBe(503);
    const healthText = await health.text();
    expect(JSON.parse(healthText)).toEqual({ ok: false, database: { driver: "sqlite", ok: false } });
    expect(healthText).not.toContain("connection refused");
  });

  it("VERSION matches package.json", () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  });
});
