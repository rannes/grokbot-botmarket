import { randomBytes } from "node:crypto";
import { openPostgresDatabase } from "../../src/db/postgres.js";
import type { Driver, SqlDatabase } from "../../src/db/sql.js";
import { openSqliteDatabase } from "../../src/db/sqlite.js";

export interface TestBackend {
  driver: Driver;
  /** A fresh, migrated, empty database. */
  open(): Promise<SqlDatabase>;
  /** Closes the database. */
  dispose(db: SqlDatabase): Promise<void>;
}

/** Every backend the contract suites run against: Postgres too when BOTMARKET_TEST_DATABASE_URL is set. */
export function testBackends(): TestBackend[] {
  const backends: TestBackend[] = [
    {
      driver: "sqlite",
      open: () => openSqliteDatabase(":memory:"),
      dispose: (db) => db.close(),
    },
  ];
  const url = process.env.BOTMARKET_TEST_DATABASE_URL;
  if (url) {
    // Each database lives in its own schema, dropped again on dispose.
    const schemas = new Map<SqlDatabase, string>();
    backends.push({
      driver: "postgres",
      async open() {
        const schema = `test_${randomBytes(4).toString("hex")}`;
        const db = await openPostgresDatabase(url, { schema });
        schemas.set(db, schema);
        return db;
      },
      async dispose(db) {
        const schema = schemas.get(db);
        schemas.delete(db);
        try {
          if (schema) await db.exec(`DROP SCHEMA ${schema} CASCADE`);
        } finally {
          await db.close();
        }
      },
    });
  }
  return backends;
}
