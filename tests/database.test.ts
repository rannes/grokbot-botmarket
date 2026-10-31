import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS, migrate } from "../src/db/migrations.js";
import type { SqlDatabase } from "../src/db/sql.js";
import { openSqliteDatabase } from "../src/db/sqlite.js";
import { testBackends } from "./helpers/backends.js";

describe.each(testBackends())("database ($driver)", (backend) => {
  let db: SqlDatabase;
  beforeEach(async () => { db = await backend.open(); });
  afterEach(async () => { await backend.dispose(db); });

  it("reports its driver and answers ping", async () => {
    expect(db.driver).toBe(backend.driver);
    await expect(db.ping()).resolves.toBeUndefined();
  });
  it("records every migration version once, even when migrate runs again", async () => {
    await migrate(db);
    const rows = await db.all<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });
  it("creates the tables", async () => {
    for (const t of ["bots", "events", "settings"]) {
      await expect(db.get(`SELECT COUNT(*) AS n FROM ${t}`)).resolves.toEqual({ n: 0 });
    }
  });
  it("run reports changes and get returns undefined for no row", async () => {
    expect(await db.run("INSERT INTO settings (key, value) VALUES (?, ?)", ["a", "1"])).toEqual({ changes: 1 });
    expect(await db.run("UPDATE settings SET value = ? WHERE key = ?", ["2", "missing"])).toEqual({ changes: 0 });
    expect(await db.get("SELECT value FROM settings WHERE key = ?", ["missing"])).toBeUndefined();
  });
  it("rolls back a failed transaction and rethrows", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO settings (key, value) VALUES (?, ?)", ["k", "v"]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.get("SELECT COUNT(*) AS n FROM settings")).toEqual({ n: 0 });
  });
  it("serialises concurrent transactions", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        db.transaction(async (tx) => {
          await tx.run("INSERT INTO settings (key, value) VALUES (?, ?)", [`k${i}`, "v"]);
          await tx.run("UPDATE settings SET value = ? WHERE key = ?", ["w", `k${i}`]);
        }),
      ),
    );
    expect(await db.get("SELECT COUNT(*) AS n FROM settings")).toEqual({ n: 25 });
  });
  it("keeps statements issued outside a transaction out of it", async () => {
    let begun!: () => void;
    let release!: () => void;
    const started = new Promise<void>((r) => (begun = r));
    const gate = new Promise<void>((r) => (release = r));
    const failing = db.transaction(async (tx) => {
      await tx.run("INSERT INTO settings (key, value) VALUES (?, ?)", ["inside", "v"]);
      begun();
      await gate;
      throw new Error("boom");
    });
    await started;
    const outside = db.run("INSERT INTO settings (key, value) VALUES (?, ?)", ["outside", "v"]);
    release();
    await expect(failing).rejects.toThrow("boom");
    await outside;
    expect(await db.all("SELECT key FROM settings")).toEqual([{ key: "outside" }]);
  });
});

describe("database (sqlite only)", () => {
  it("sets a 5 second busy timeout", async () => {
    const db = await openSqliteDatabase(":memory:");
    try {
      expect(await db.get("PRAGMA busy_timeout")).toEqual({ timeout: 5000 });
    } finally {
      await db.close();
    }
  });
});
