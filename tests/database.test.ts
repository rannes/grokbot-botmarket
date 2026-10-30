import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { MIGRATIONS, migrate } from "../src/db/migrations.js";

describe("database", () => {
  it("creates all tables", () => {
    const db = openDatabase(":memory:");
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of ["bots", "events", "settings", "schema_migrations"]) expect(names).toContain(t);
  });

  it("records every migration version", () => {
    const db = openDatabase(":memory:");
    const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {
      version: number;
    }[];
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });

  it("sets a 5 second busy timeout", () => {
    const db = openDatabase(":memory:");
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });

  it("is idempotent", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    migrate(db);
    const n = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    expect(n.n).toBe(MIGRATIONS.length);
    openDatabase(":memory:");
  });
});
