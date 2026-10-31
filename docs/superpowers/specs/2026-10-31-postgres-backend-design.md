# Postgres backend design

Date: 2026-10-31. Builds on `2026-10-31-botmarket-design.md` (the marketplace itself).

## Intent

Operators pick the database with one environment variable. With no database URL set, BotMarket keeps
using its zero-config SQLite file. With a Postgres URL set, it uses Postgres instead, which is what
hosted platforms (Railway, Render, Fly, Heroku-style stacks) and multi-instance deployments need. An
API endpoint reports which backend is active so an operator can confirm the configuration took.

## Goals

- Identical observable behaviour on both backends: every repository method returns the same results
  for the same calls. A single contract test suite runs against both.
- Zero change for existing SQLite users: same file, same path, same migrations table; an existing
  `botmarket.sqlite` keeps working.
- Migrations run automatically on startup for both backends and are safe when several instances
  start at once against the same Postgres.
- Fail fast and clearly: a malformed URL stops startup with a message; an unreachable Postgres stops
  `serve` with a message. The connection string is never printed or served.
- `GET /api/status` reports the driver; `GET /healthz` reports it too and goes unhealthy when the
  database cannot be reached.

## Non-goals

- Moving data between backends (use `export` / `import` of a catalog).
- Other databases (MySQL, etc.). The abstraction is just wide enough for these two.
- Postgres-only features (JSONB queries, full-text search, listen/notify).
- Pool tuning knobs beyond what the URL carries. Pool size and timeouts are fixed defaults.

## Anti-goals

- Leaking the URL, host, user or database name through the API, logs or error pages.
- A SQLite regression: interleaved statements from concurrent requests must not land inside another
  request's open transaction.
- Letting a bad `DATABASE_URL` silently fall back to SQLite. Set means Postgres or exit.

## Configuration

`loadConfig(env)` reads `BOTMARKET_DATABASE_URL` first, then `DATABASE_URL`. Blank or whitespace-only
values count as unset.

- Unset → `databaseDriver: 'sqlite'`, `databaseUrl: null`, `dbPath` as today.
- Set → the value must parse with `new URL()` and have protocol `postgres:` or `postgresql:`
  (case-insensitive). Then `databaseDriver: 'postgres'`, `databaseUrl: <trimmed value>`.
- Otherwise `loadConfig` throws
  `Error('<VAR> must be a postgres:// or postgresql:// URL')` where `<VAR>` is the variable that was
  read (`BOTMARKET_DATABASE_URL` or `DATABASE_URL`). The message never includes the value.

`Config` keeps every existing field (`dbPath` stays, unused under Postgres) and adds
`databaseUrl: string | null` and `databaseDriver: 'sqlite' | 'postgres'`.

TLS is whatever node-postgres derives from the URL: `?sslmode=require` (or `verify-full`) connects
with TLS and verifies the server certificate; `?sslmode=no-verify` connects with TLS without
verification; no `sslmode` means no TLS. This is documented, not re-implemented.

## Data access layer

### Interfaces (`src/db/sql.ts`)

```ts
export type Driver = 'sqlite' | 'postgres';
export type SqlValue = string | number | null;
export type SqlRow = Record<string, unknown>;

export interface SqlExecutor {
  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Runs one or more statements with no parameters (DDL). */
  exec(sql: string): Promise<void>;
}

export interface SqlDatabase extends SqlExecutor {
  readonly driver: Driver;
  /** Runs fn inside BEGIN/COMMIT; any throw rolls back and rethrows. Not re-entrant. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  /** Resolves when `SELECT 1` succeeds; rejects otherwise. */
  ping(): Promise<void>;
  close(): Promise<void>;
}
```

Placeholders: every query in the repository and migrations uses `?`. The Postgres executor rewrites
the n-th `?` to `$n` before sending. Queries never contain a literal `?` inside a string; a unit test
pins the rewriter (`'a = ? AND b = ?'` → `'a = $1 AND b = $2'`, no `?` → unchanged).

### SQLite executor (`src/db/sqlite.ts`)

`openSqliteDatabase(path): Promise<SqlDatabase>` wraps `node:sqlite`'s `DatabaseSync` with the same
PRAGMAs as today (`busy_timeout = 5000`, WAL unless `:memory:`, `foreign_keys = ON`), runs the
migrations, and returns the executor. `driver` is `'sqlite'`.

Because `DatabaseSync` is synchronous and shared, the executor serialises transactions: `transaction`
calls are queued on an internal promise chain, and statements issued through the outer executor wait
for any open transaction to finish before they run. Statements issued through the `tx` executor
passed to the transaction body run immediately. Calling `transaction` inside a transaction body is a
programming error and is not supported (there is none in the code).

### Postgres executor (`src/db/postgres.ts`)

`openPostgresDatabase(url, opts?: { schema?: string }): Promise<SqlDatabase>` uses `pg.Pool` with
`connectionString: url`, `max: 10`, `connectionTimeoutMillis: 10_000`, `idleTimeoutMillis: 30_000`.
`int8` (OID 20) is parsed to `Number` so `COUNT(*)` comes back as a number like it does from SQLite.
`pool.on('error')` logs `Postgres pool error: <message>` to stderr and keeps running. `transaction`
checks out one client, runs `BEGIN`, the body against that client, then `COMMIT` or `ROLLBACK`, and
always releases the client. `run` reports `rowCount` as `changes`. `exec` sends the text with the
simple query protocol (no values) so multi-statement DDL works. `close` ends the pool.

`opts.schema` (tests only): the pool connects with `options: '-c search_path=<schema>'`, and the
opener runs `CREATE SCHEMA IF NOT EXISTS <schema>` before migrating. The schema name must match
`/^[a-z_][a-z0-9_]{0,62}$/` or the opener throws. The server never passes it.

The opener pings once before returning; a failure rejects with
`Error('Cannot connect to Postgres: <driver message>')`. The URL is not part of the message.

### `openDatabase` (`src/db/database.ts`)

`openDatabase(config: Pick<Config, 'databaseDriver' | 'databaseUrl' | 'dbPath'>): Promise<SqlDatabase>`
dispatches to the opener for the configured driver. `serve`, `import` and `export` use it and close
the database when done. On startup `serve` logs `Database: sqlite (<path>)` or `Database: postgres`
unless quiet.

### Migrations (`src/db/migrations.ts`)

```ts
export interface Migration { version: number; sqlite: string; postgres: string }
export const MIGRATIONS: Migration[];
export async function migrate(db: SqlDatabase): Promise<void>;
```

`migrate` creates `schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)` if
missing, reads the applied versions, and applies each missing migration inside one transaction:
`exec` of the dialect's DDL, then the `schema_migrations` row. Under Postgres the transaction first
runs `SELECT pg_advisory_xact_lock(1651668077)` so concurrent instances apply migrations one at a
time; the second one then finds the version already recorded and skips it.

Version 1 is the existing SQLite DDL (unchanged, so existing databases match) and its Postgres
equivalent:

- `bots`: same columns and types (`TEXT`, `INTEGER NOT NULL DEFAULT 0` for `featured`,
  `install_clicks`, `upvotes`) plus `id BIGINT GENERATED ALWAYS AS IDENTITY` as the insertion-order
  tiebreaker (SQLite uses `rowid` for this). `slug TEXT PRIMARY KEY`. Same two indexes.
- `events`: `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, same other columns, same
  `UNIQUE(slug, kind, visitor_hash, day)`.
- `settings`: identical.

Row shapes are identical on both backends: flags are integers 0/1, timestamps are ISO-8601 text,
tags and recipes are JSON text. No `BOOLEAN`, `TIMESTAMP` or `JSONB` columns.

### Repository (`src/db/bots-repo.ts`)

`new BotsRepo(db: SqlDatabase, now?: () => Date)`. Every public method keeps its name, parameters and
result but becomes `async` (returns a Promise): `list`, `count`, `get`, `insert`, `update`, `delete`,
`setStatus`, `setFeatured`, `recordEvent`, `categoryCounts`, `upsertFromCatalog`. New members:
`readonly driver: Driver` (from the database), `ping(): Promise<void>`, `close(): Promise<void>`.

SQL changes for portability, applied to both backends:

- `INSERT OR IGNORE INTO events …` becomes `INSERT INTO events … ON CONFLICT DO NOTHING`.
- Order tiebreakers use `rowid` under SQLite and `id` under Postgres (chosen from `db.driver`).
- `delete` and `recordEvent` use `db.transaction`. `recordEvent` returns `false` without touching the
  counters when the bot is missing or the `(slug, kind, visitor_hash, day)` row already exists.
- Everything else (`lower(col) LIKE ? ESCAPE '\'`, `ON CONFLICT`, `COUNT(*)`, `RETURNING`-free
  inserts followed by `get`) already works on both.

`seedIfEmpty` becomes async. `startServer`, the CLI commands and every route handler await the
repository. Route handlers that were synchronous become `async`.

## Status reporting

- `GET /api/status` → `200 {"version":"<package.json version>","database":{"driver":"sqlite","ok":true}}`.
  If `repo.ping()` rejects → `503 {"version":…,"database":{"driver":…,"ok":false}}`. The body never
  contains anything else about the database. `Cache-Control: no-store`.
- `GET /healthz` → `200 {"ok":true,"database":{"driver":…,"ok":true}}`, or
  `503 {"ok":false,"database":{"driver":…,"ok":false}}` when the ping fails. The Docker healthcheck
  keeps working unchanged and now fails when Postgres is down.
- The admin dashboard header shows `Database: sqlite` / `Database: postgres` next to the counts.
- `VERSION` is read once from `package.json` via `createRequire(import.meta.url)('../package.json')`
  in `src/version.ts` (same relative path from `dist/version.js`).

## Tests

- `tests/bots-repo.test.ts`, `tests/database.test.ts` and `tests/seed.test.ts` become contract suites
  that run for every available backend: always SQLite (`:memory:`), and Postgres when
  `BOTMARKET_TEST_DATABASE_URL` is set. Every test opens a fresh database: `:memory:` for SQLite, and
  for Postgres a new schema named `test_<8 hex chars>` that is dropped when the test ends, so test
  files can run in parallel under the forks pool without sharing tables.
- A test proves SQLite transactions do not interleave: 25 concurrent `recordEvent` calls with
  different visitor hashes all resolve `true`, the counter reads 25, and no call rejects.
- A test proves `recordEvent` is idempotent per visitor per day on both backends.
- Route tests keep using in-memory SQLite. `GET /api/status` and `/healthz` tests cover the SQLite
  answer and the 503 path using a repository stub whose `ping` rejects.
- CLI tests cover `serve` exiting with code 1 and the message when `DATABASE_URL=mysql://x`.
- `config.test.ts` covers precedence, blank values, bad scheme, and the exact error message.
- CI runs the suite with a `postgres:17-alpine` service and `BOTMARKET_TEST_DATABASE_URL` set, so the
  Postgres contract tests always run there.

## Operations and docs

- `README.md` gets a **Database** section: SQLite default and where the file lives; Postgres via
  `DATABASE_URL` / `BOTMARKET_DATABASE_URL`; `sslmode` notes; automatic migrations; a note that rate
  limits and the admin cookie salt are per process, so multi-instance deployments share data but not
  limits; how to check the backend (`/api/status`).
- `docs/api.md` documents `GET /api/status` and the new `/healthz` body.
- `docker-compose.postgres.yml` is an override that adds a `postgres:17-alpine` service with a named
  volume and healthcheck, and sets `DATABASE_URL` on `botmarket`:
  `docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d`.
- The CLI usage text lists `BOTMARKET_DATABASE_URL` / `DATABASE_URL`.
- `package.json` adds `pg` (runtime) and `@types/pg` (dev).

## Left to the builder

- Exact internal structure of the SQLite promise chain and the test schema helper.
- Wording of the startup log lines beyond the two given above.
- How the contract suite enumerates backends (a small shared helper under `tests/` is fine).
