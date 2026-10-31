import pg from "pg";
import { migrate } from "./migrations.js";
import type { Driver, SqlDatabase, SqlExecutor, SqlRow, SqlValue } from "./sql.js";

const { Pool, types } = pg;

// int8 (COUNT(*), BIGINT) as a number, the way node:sqlite returns it. This process has no other pg user.
types.setTypeParser(20, Number);

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Rewrites the n-th `?` to `$n`. Queries never contain a literal `?` inside a string. */
export function rewritePlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** What the executor needs from a pool or a checked-out client. */
interface Queryable {
  query<R extends pg.QueryResultRow>(text: string, values?: SqlValue[]): Promise<pg.QueryResult<R>>;
}

function executor(q: Queryable): SqlExecutor {
  return {
    async all<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return (await q.query<T>(rewritePlaceholders(sql), params)).rows;
    },
    async get<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): Promise<T | undefined> {
      return (await q.query<T>(rewritePlaceholders(sql), params)).rows[0];
    },
    async run(sql: string, params: SqlValue[] = []): Promise<{ changes: number }> {
      return { changes: (await q.query(rewritePlaceholders(sql), params)).rowCount ?? 0 };
    },
    async exec(sql: string): Promise<void> {
      // No values: the simple query protocol, which accepts several statements in one text.
      await q.query(sql);
    },
  };
}

class PostgresDatabase implements SqlDatabase {
  readonly driver: Driver = "postgres";
  private readonly direct: SqlExecutor;

  constructor(private readonly pool: pg.Pool) {
    this.direct = executor(pool);
  }

  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return this.direct.all<T>(sql, params);
  }

  get<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T | undefined> {
    return this.direct.get<T>(sql, params);
  }

  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }> {
    return this.direct.run(sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.direct.exec(sql);
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    // A client whose ROLLBACK failed may still be inside the transaction: destroy it instead of pooling it.
    let discard = false;
    try {
      await client.query("BEGIN");
      const value = await fn(executor(client));
      await client.query("COMMIT");
      return value;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true; // the body's error is the one worth reporting
      }
      throw e;
    } finally {
      client.release(discard);
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

/**
 * Connects, checks the connection and migrates. `schema` (tests only) puts every table in that
 * schema, creating it if needed. Errors never include the URL: it may carry credentials.
 */
export async function openPostgresDatabase(url: string, opts: { schema?: string } = {}): Promise<SqlDatabase> {
  const { schema } = opts;
  if (schema !== undefined && !SCHEMA_NAME.test(schema)) throw new Error(`Invalid Postgres schema name: ${schema}`);
  const pool = new Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  pool.on("error", (e) => console.error("Postgres pool error:", e.message));
  const db = new PostgresDatabase(pool);
  try {
    try {
      await db.ping();
    } catch (e) {
      throw new Error(`Cannot connect to Postgres: ${(e as Error).message}`);
    }
    if (schema) await db.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await migrate(db);
    return db;
  } catch (e) {
    try {
      await pool.end();
    } catch {
      /* the original error is the one worth reporting */
    }
    throw e;
  }
}
