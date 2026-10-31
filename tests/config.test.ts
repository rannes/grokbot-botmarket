import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses defaults when env is empty", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.siteName).toBe("BotMarket");
    expect(c.requireApproval).toBe(false);
    expect(c.adminToken).toBeNull();
    expect(c.publicUrl).toBeNull();
    expect(c.dataDir).toBe("./data");
    expect(c.dbPath).toBe("data/botmarket.sqlite");
    expect(c.trustProxy).toBe(false);
  });

  it("reads BOTMARKET_TRUST_PROXY", () => {
    expect(loadConfig({ BOTMARKET_TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ BOTMARKET_TRUST_PROXY: "1" }).trustProxy).toBe(true);
    expect(loadConfig({ BOTMARKET_TRUST_PROXY: "no" }).trustProxy).toBe(false);
    expect(loadConfig({ BOTMARKET_TRUST_PROXY: "maybe" }).trustProxy).toBe(false);
  });

  it("reads env overrides and strips trailing slash from public url", () => {
    const c = loadConfig({
      PORT: "8080",
      BOTMARKET_REQUIRE_APPROVAL: "true",
      BOTMARKET_PUBLIC_URL: "https://m.example/",
      BOTMARKET_ADMIN_TOKEN: "s3cret",
      BOTMARKET_SITE_NAME: "Acme Bots",
      BOTMARKET_DATA_DIR: "/data",
    });
    expect(c.port).toBe(8080);
    expect(c.requireApproval).toBe(true);
    expect(c.publicUrl).toBe("https://m.example");
    expect(c.adminToken).toBe("s3cret");
    expect(c.siteName).toBe("Acme Bots");
    expect(c.dbPath).toBe("/data/botmarket.sqlite");
  });

  it("treats blank admin token as unset and non-numeric port as default", () => {
    const c = loadConfig({ BOTMARKET_ADMIN_TOKEN: "   ", PORT: "abc" });
    expect(c.adminToken).toBeNull();
    expect(c.port).toBe(3000);
  });
});

describe("database url", () => {
  it("defaults to sqlite", () => {
    const c = loadConfig({});
    expect(c.databaseDriver).toBe("sqlite");
    expect(c.databaseUrl).toBeNull();
    expect(c.dbPath).toBe("data/botmarket.sqlite");
  });
  it("uses postgres when DATABASE_URL is set", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://u:p@db:5432/bm" });
    expect(c.databaseDriver).toBe("postgres");
    expect(c.databaseUrl).toBe("postgres://u:p@db:5432/bm");
  });
  it("prefers BOTMARKET_DATABASE_URL over DATABASE_URL", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://a/one", BOTMARKET_DATABASE_URL: " postgresql://b/two " });
    expect(c.databaseUrl).toBe("postgresql://b/two");
  });
  it("treats blank values as unset", () => {
    expect(loadConfig({ DATABASE_URL: "   " }).databaseDriver).toBe("sqlite");
    expect(loadConfig({ BOTMARKET_DATABASE_URL: "", DATABASE_URL: "postgres://x/y" }).databaseDriver).toBe("postgres");
  });
  it("accepts an uppercase scheme and query parameters", () => {
    expect(loadConfig({ DATABASE_URL: "POSTGRESQL://u@h/d?sslmode=require" }).databaseDriver).toBe("postgres");
  });
  it("rejects other schemes and names the variable without echoing the value", () => {
    expect(() => loadConfig({ DATABASE_URL: "mysql://u:secret@h/d" })).toThrow(
      "DATABASE_URL must be a postgres:// or postgresql:// URL",
    );
    expect(() => loadConfig({ BOTMARKET_DATABASE_URL: "not a url" })).toThrow(
      "BOTMARKET_DATABASE_URL must be a postgres:// or postgresql:// URL",
    );
    try { loadConfig({ DATABASE_URL: "mysql://u:secret@h/d" }); } catch (e) {
      expect((e as Error).message).not.toContain("secret");
    }
  });
});
