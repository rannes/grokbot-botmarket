import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.js";
import type { Driver, SqlDatabase, SqlExecutor, SqlRow, SqlValue } from "./sql.js";

/** Statements straight against the connection, with no queueing. */
function directExecutor(db: DatabaseSync): SqlExecutor {
  return {
    async all<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async get<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    async run(sql: string, params: SqlValue[] = []): Promise<{ changes: number }> {
      return { changes: Number(db.prepare(sql).run(...params).changes) };
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
  };
}

/**
 * One shared DatabaseSync connection. Transactions run one at a time on a promise chain, and
 * statements on this object wait for any open transaction, so concurrent requests never land inside
 * another request's BEGIN/COMMIT. Statements on the `tx` executor given to a body run immediately.
 */
class SqliteDatabase implements SqlDatabase {
  readonly driver: Driver = "sqlite";
  private readonly direct: SqlExecutor;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly db: DatabaseSync) {
    this.direct = directExecutor(db);
  }

  async all<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T[]> {
    await this.queue;
    return this.direct.all<T>(sql, params);
  }

  async get<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T | undefined> {
    await this.queue;
    return this.direct.get<T>(sql, params);
  }

  async run(sql: string, params?: SqlValue[]): Promise<{ changes: number }> {
    await this.queue;
    return this.direct.run(sql, params);
  }

  async exec(sql: string): Promise<void> {
    await this.queue;
    return this.direct.exec(sql);
  }

  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      this.db.exec("BEGIN");
      try {
        const value = await fn(this.direct);
        this.db.exec("COMMIT");
        return value;
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async ping(): Promise<void> {
    await this.get("SELECT 1");
  }

  async close(): Promise<void> {
    await this.queue;
    this.db.close();
  }
}

export async function openSqliteDatabase(path: string): Promise<SqlDatabase> {
  const memory = path === ":memory:";
  if (!memory) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    // Wait up to 5 s for a lock (e.g. a CLI import or backup running alongside the server) instead of failing with SQLITE_BUSY.
    db.exec("PRAGMA busy_timeout = 5000");
    if (!memory) db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    const sqlite = new SqliteDatabase(db);
    await migrate(sqlite);
    return sqlite;
  } catch (e) {
    db.close();
    throw e;
  }
}
