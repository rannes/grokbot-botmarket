import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../src/db/migrations.js";
import { openPostgresDatabase, rewritePlaceholders } from "../src/db/postgres.js";

describe("rewritePlaceholders", () => {
  it("numbers each ? in order", () => {
    expect(rewritePlaceholders("a = ? AND b = ?")).toBe("a = $1 AND b = $2");
  });
  it("leaves sql without placeholders alone", () => {
    expect(rewritePlaceholders("SELECT 1")).toBe("SELECT 1");
  });
});
describe("openPostgresDatabase", () => {
  it("rejects an invalid schema name before connecting", async () => {
    await expect(openPostgresDatabase("postgres://u:p@127.0.0.1:1/db", { schema: "bad-name" })).rejects.toThrow(/schema/);
  });
  it("fails with a message that does not echo the url", async () => {
    await expect(openPostgresDatabase("postgres://user:hunter2@127.0.0.1:1/db")).rejects.toThrow(/Cannot connect to Postgres/);
    await openPostgresDatabase("postgres://user:hunter2@127.0.0.1:1/db").catch((e: Error) => {
      expect(e.message).not.toContain("hunter2");
    });
  });
  it("gives a reason when every address of localhost refuses", async () => {
    const e = await openPostgresDatabase("postgres://user:hunter2@localhost:1/db").then(
      () => new Error("connected"),
      (err: Error) => err,
    );
    expect(e.message).toMatch(/^Cannot connect to Postgres: \S/);
    expect(e.message).not.toContain("hunter2");
  });
});

const url = process.env.BOTMARKET_TEST_DATABASE_URL;

describe.skipIf(!url)("openPostgresDatabase (live server)", () => {
  // A plain client for arranging and inspecting schemas outside the code under test.
  let admin: pg.Client;
  const schemas: string[] = [];
  function freshSchema(): string {
    const schema = `test_${randomBytes(4).toString("hex")}`;
    schemas.push(schema);
    return schema;
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
  });
  afterAll(async () => {
    for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("migrates once when several instances start together on an empty schema", async () => {
    const schema = freshSchema();
    await admin.query(`CREATE SCHEMA ${schema}`);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => openPostgresDatabase(url!, { schema })));
    const dbs = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    try {
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      const rows = await dbs[0]!.all<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
      expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
    } finally {
      await Promise.all(dbs.map((db) => db.close()));
    }
  });

  it("rolls back a failed migration and ends its pool", async () => {
    const schema = freshSchema();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE TABLE ${schema}.bots (x INTEGER)`);
    const tagged = new URL(url!);
    tagged.searchParams.set("application_name", schema);
    await expect(openPostgresDatabase(tagged.href, { schema })).rejects.toThrow(/already exists/);
    // One transaction: the schema_migrations table created before the failing DDL is gone too.
    const { rows } = await admin.query("SELECT to_regclass($1) AS t", [`${schema}.schema_migrations`]);
    expect(rows[0].t).toBeNull();
    await vi.waitFor(
      async () => {
        const r = await admin.query("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE application_name = $1", [schema]);
        expect(r.rows[0].n).toBe(0);
      },
      { timeout: 5000, interval: 50 },
    );
  });
});
