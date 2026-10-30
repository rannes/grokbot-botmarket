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
