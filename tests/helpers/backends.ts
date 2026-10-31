import type { Driver, SqlDatabase } from "../../src/db/sql.js";
import { openSqliteDatabase } from "../../src/db/sqlite.js";

export interface TestBackend {
  driver: Driver;
  /** A fresh, migrated, empty database. */
  open(): Promise<SqlDatabase>;
  /** Closes the database. */
  dispose(db: SqlDatabase): Promise<void>;
}

/** Every backend the contract suites run against. */
export function testBackends(): TestBackend[] {
  return [
    {
      driver: "sqlite",
      open: () => openSqliteDatabase(":memory:"),
      dispose: (db) => db.close(),
    },
  ];
}
