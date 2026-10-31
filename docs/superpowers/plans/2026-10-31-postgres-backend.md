# Postgres Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BotMarket uses Postgres when `DATABASE_URL` (or `BOTMARKET_DATABASE_URL`) is set and SQLite otherwise, with `GET /api/status` and `/healthz` reporting the active driver.

**Architecture:** One `BotsRepo` runs on top of a four-method `SqlExecutor` abstraction with two implementations: a serialising wrapper over `node:sqlite` and a `pg.Pool` wrapper. Queries use `?` placeholders (rewritten to `$n` for Postgres), rows have identical shapes on both backends, and migrations carry per-dialect DDL under shared version numbers. Every repository method becomes async and every caller awaits it.

**Tech Stack:** Node 22 (`node:sqlite`), TypeScript strict ESM, Hono 4, `pg` 8.23 + `@types/pg`, Vitest (forks pool), GitHub Actions with a `postgres:17-alpine` service.

**Spec:** `docs/superpowers/specs/2026-10-31-postgres-backend-design.md`

## Global Constraints

- Node `>=22.13.0`; no native dependencies; TypeScript strict; ESM with `.js` import suffixes.
- Every SQL statement in `src/db/` uses `?` placeholders and never contains a literal `?` in a string.
- Row shapes are identical across backends: flags `INTEGER` 0/1, timestamps ISO-8601 `TEXT`, JSON as `TEXT`.
- The connection string is never logged, served, or included in an error message.
- Existing SQLite databases keep working: migration version 1's SQLite DDL is byte-for-byte unchanged.
- Tests: `npm test` passes with and without `BOTMARKET_TEST_DATABASE_URL`; `npm run typecheck` is clean.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. Concurrent requests on SQLite (25 parallel `recordEvent` calls): every call resolves, none rejects with "cannot start a transaction within a transaction", counter equals 25. Test in Task 2.
2. `DATABASE_URL` set to blank, to `mysql://…`, or to `POSTGRESQL://…`: blank means SQLite, wrong scheme throws the exact message, uppercase scheme is accepted. Tests in Task 1.
3. Postgres unreachable at `serve` start: exit code 1 and a message that does not contain the password from the URL. Test in Task 3.
4. Search text containing `%`, `_` and `\`: matches only literal characters on both backends. Test in Task 2 (runs on Postgres via Task 3's backend helper).
5. `/healthz` and `/api/status` when the database ping fails: 503 with `ok:false`, driver still reported. Test in Task 4.

---

### Task 1: Database URL in config

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `Config.databaseUrl: string | null`, `Config.databaseDriver: 'sqlite' | 'postgres'`; `loadConfig` throws `Error` with message `` `${VAR} must be a postgres:// or postgresql:// URL` `` for a bad value, where `VAR` is `BOTMARKET_DATABASE_URL` or `DATABASE_URL` (whichever was read).

- [ ] **Step 1: Write the failing tests** in `tests/config.test.ts` (keep every existing test):

```ts
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
```

- [ ] **Step 2: Run** `npx vitest run tests/config.test.ts` — expected: the new tests FAIL (`databaseDriver` undefined).

- [ ] **Step 3: Implement** in `src/config.ts`: add the two fields to `Config` (with doc comments naming both variables), read `BOTMARKET_DATABASE_URL` then `DATABASE_URL` through `nonEmpty`, validate with `URL.canParse` and `new URL(v).protocol.toLowerCase()` in `['postgres:', 'postgresql:']`, throw on anything else.

- [ ] **Step 4: Run** `npx vitest run tests/config.test.ts && npm run typecheck` — expected: PASS, clean.

- [ ] **Step 5: Commit** `feat(config): select postgres with DATABASE_URL`.

---

### Task 2: Async data layer over a SQL executor (SQLite implementation)

**Files:**
- Create: `src/db/sql.ts`, `src/db/sqlite.ts`, `tests/helpers/backends.ts`
- Modify: `src/db/migrations.ts`, `src/db/database.ts`, `src/db/bots-repo.ts`, `src/db/seed.ts`, `src/server.ts`, `src/index.ts`, `src/routes/api.ts`, `src/routes/install.ts`, `src/routes/admin.tsx`, `src/routes/pages.tsx`, `src/routes/submit.tsx`
- Test: `tests/database.test.ts`, `tests/bots-repo.test.ts`, `tests/seed.test.ts`, plus `await` fixes in `tests/app.test.ts`, `tests/admin.test.ts`, `tests/install-api.test.ts`, `tests/cli.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: `Config.databaseDriver`, `Config.databaseUrl`, `Config.dbPath` (Task 1).
- Produces (`src/db/sql.ts`, verbatim from the spec):

```ts
export type Driver = 'sqlite' | 'postgres';
export type SqlValue = string | number | null;
export type SqlRow = Record<string, unknown>;
export interface SqlExecutor {
  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}
export interface SqlDatabase extends SqlExecutor {
  readonly driver: Driver;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
```

- Produces (`src/db/sqlite.ts`): `openSqliteDatabase(path: string): Promise<SqlDatabase>` — same PRAGMAs as today, runs `migrate`, `driver === 'sqlite'`.
- Produces (`src/db/migrations.ts`): `interface Migration { version: number; sqlite: string; postgres: string }`, `MIGRATIONS: Migration[]`, `migrate(db: SqlDatabase): Promise<void>`. Version 1's `sqlite` string is the current DDL unchanged; its `postgres` string follows the spec (`id BIGINT GENERATED ALWAYS AS IDENTITY` on `bots` and as the `events` primary key, everything else identical). Under `driver === 'postgres'` the per-migration transaction starts with `SELECT pg_advisory_xact_lock(1651668077)`.
- Produces (`src/db/database.ts`): `openDatabase(config: Pick<Config, 'databaseDriver' | 'databaseUrl' | 'dbPath'>): Promise<SqlDatabase>` — sqlite → `openSqliteDatabase(config.dbPath)`; postgres → `throw new Error('Postgres driver is added in Task 3')` (Task 3 replaces this branch).
- Produces (`src/db/bots-repo.ts`): `new BotsRepo(db: SqlDatabase, now?: () => Date)`; all existing public methods keep names, parameters and return values but return Promises; new `readonly driver: Driver`, `ping(): Promise<void>`, `close(): Promise<void>`.
- Produces (`src/db/seed.ts`): `seedIfEmpty(repo, catalogPath): Promise<{ seeded: number }>`.
- Produces (`tests/helpers/backends.ts`):

```ts
export interface TestBackend {
  driver: Driver;
  open(): Promise<SqlDatabase>;            // fresh, migrated, empty
  dispose(db: SqlDatabase): Promise<void>; // closes (Task 3 adds schema drop for postgres)
}
export function testBackends(): TestBackend[]; // [sqlite] now; Task 3 appends postgres when BOTMARKET_TEST_DATABASE_URL is set
```

- [ ] **Step 1: Write the failing executor and migration tests** by rewriting `tests/database.test.ts` as a contract suite:

```ts
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
});
```

Keep a SQLite-only `it("sets a 5 second busy timeout")` that opens `openSqliteDatabase(":memory:")` and checks `db.get("PRAGMA busy_timeout")` equals `{ timeout: 5000 }`.

- [ ] **Step 2: Run** `npx vitest run tests/database.test.ts` — expected: FAIL (modules missing).

- [ ] **Step 3: Implement** `src/db/sql.ts` (types above), `src/db/migrations.ts` (shape above; `migrate` creates `schema_migrations` with `exec`, selects applied versions, applies each missing one inside `db.transaction`, taking the advisory lock first under Postgres), `src/db/sqlite.ts` (executor over `DatabaseSync`; `all/get/run` prepare and bind `params ?? []`; `run` returns `{ changes: Number(result.changes) }`; `exec` calls `db.exec`; `transaction` chains on a private `Promise` so transactions run one at a time, and `all/get/run/exec` on the outer executor `await` the chain before running while the `tx` executor given to the body runs directly; `ping` runs `SELECT 1`; `close` calls `db.close()`), and `src/db/database.ts` (dispatch above). Create `tests/helpers/backends.ts` returning the SQLite backend (`open: () => openSqliteDatabase(':memory:')`, `dispose: (db) => db.close()`).

- [ ] **Step 4: Run** `npx vitest run tests/database.test.ts` — expected: PASS.

- [ ] **Step 5: Convert the repository tests** — rewrite `tests/bots-repo.test.ts` as `describe.each(testBackends())("BotsRepo ($driver)", …)` with `repo = new BotsRepo(await backend.open(), () => clock)` in `beforeEach` and `await repo.close()` / `backend.dispose` in `afterEach`; every repo call gets `await`. Keep all existing assertions. Add:

```ts
it("counts concurrent events from different visitors without interleaving", async () => {
  await repo.insert(mk("Busy"));
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) => repo.recordEvent("busy", "upvote", `visitor-${i}`)),
  );
  expect(results.every(Boolean)).toBe(true);
  expect((await repo.get("busy"))!.upvotes).toBe(25);
});
it("ignores a repeat event from the same visitor on the same day", async () => {
  await repo.insert(mk("Once"));
  expect(await repo.recordEvent("once", "upvote", "v1")).toBe(true);
  expect(await repo.recordEvent("once", "upvote", "v1")).toBe(false);
  expect((await repo.get("once"))!.upvotes).toBe(1);
});
it("treats %, _ and \\ in search text literally", async () => {
  await repo.insert(mk("100% done"));
  await repo.insert(mk("under_score"));
  await repo.insert(mk("back\\slash"));
  await repo.insert(mk("plain"));
  expect((await repo.list({ q: "100%" })).map((b) => b.name)).toEqual(["100% done"]);
  expect((await repo.list({ q: "r_s" })).map((b) => b.name)).toEqual(["under_score"]);
  expect((await repo.list({ q: "k\\s" })).map((b) => b.name)).toEqual(["back\\slash"]);
  expect(await repo.count({ q: "%" })).toBe(1);
});
it("keeps insertion order as the tiebreaker for equal timestamps", async () => {
  await repo.insert(mk("First")); await repo.insert(mk("Second")); await repo.insert(mk("Third"));
  expect((await repo.list({ sort: "new" })).map((b) => b.slug)).toEqual(["third", "second", "first"]);
});
```

Convert `tests/seed.test.ts` the same way (`describe.each(testBackends())`, `await seedIfEmpty(...)`).

- [ ] **Step 6: Run** `npx vitest run tests/bots-repo.test.ts tests/seed.test.ts` — expected: FAIL (sync repo).

- [ ] **Step 7: Implement** the async `BotsRepo` over `SqlDatabase`: same SQL as today except `INSERT OR IGNORE` → `INSERT … ON CONFLICT DO NOTHING`, the order tiebreaker column chosen once in the constructor (`rowid` for sqlite, `id` for postgres), `delete` and `recordEvent` inside `db.transaction`, `featured: Number(r.featured) === 1`, `installClicks`/`upvotes` through `Number(...)`. Make `seedIfEmpty` async.

- [ ] **Step 8: Run** `npx vitest run tests/bots-repo.test.ts tests/seed.test.ts` — expected: PASS.

- [ ] **Step 9: Convert the callers** — `src/server.ts` (`const db = await openDatabase(config)`, close with `await db.close()`; log `Database: sqlite (<path>)` / `Database: postgres` unless quiet), `src/index.ts` (`import` and `export` open with `await openDatabase(loadConfig(io.env))` and close in `finally`), route handlers in `api.ts`, `install.ts`, `admin.tsx`, `pages.tsx`, `submit.tsx` (`async` handlers, `await` every repo call; where a page calls `repo.categoryCounts()` inside JSX, await it into a variable first). Update the remaining tests' setup code to `await` repo calls and open databases through `openSqliteDatabase(':memory:')`.

- [ ] **Step 10: Run** `npm run typecheck && npm test` — expected: clean and all green (count ≥ 230 + new tests).

- [ ] **Step 11: Commit** `refactor(db): async repository over a SQL executor abstraction`.

---

### Task 3: Postgres executor, backend dispatch and CI service

**Files:**
- Create: `src/db/postgres.ts`, `tests/postgres.test.ts`
- Modify: `src/db/database.ts`, `package.json`, `package-lock.json`, `tests/helpers/backends.ts`, `tests/cli.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `SqlDatabase`, `SqlExecutor`, `migrate` (Task 2); `Config.databaseUrl` (Task 1).
- Produces: `openPostgresDatabase(url: string, opts?: { schema?: string }): Promise<SqlDatabase>`; `rewritePlaceholders(sql: string): string` (exported for the unit test); `openDatabase` dispatches `'postgres'` to it.

The controller provides a running Postgres and sets `BOTMARKET_TEST_DATABASE_URL` in the implementer's environment; the Postgres-backed tests are skipped when it is unset.

- [ ] **Step 1: Write the failing tests** in `tests/postgres.test.ts`:

```ts
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
});
```

Add to `tests/cli.test.ts`: `serve` with `DATABASE_URL: "postgres://user:hunter2@127.0.0.1:1/db"` returns `1` and writes a line to stderr containing `Cannot connect to Postgres` and not containing `hunter2`.

- [ ] **Step 2: Run** `npx vitest run tests/postgres.test.ts tests/cli.test.ts` — expected: FAIL (module missing).

- [ ] **Step 3: Install** `npm install pg@8 && npm install -D @types/pg@8`. **Implement** `src/db/postgres.ts`: `pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000, ...(schema ? { options: `-c search_path=${schema}` } : {}) })`, `pg.types.setTypeParser(20, Number)` so int8 arrives as a number (the global registry is acceptable: this is the process's only pg consumer), `pool.on('error', e => console.error('Postgres pool error:', e.message))`, executor methods per the spec (`run` → `rowCount ?? 0`, `exec` → `query(text)` with no values, `transaction` → checked-out client with `BEGIN`/`COMMIT`/`ROLLBACK` and `release` in `finally`), schema name check `/^[a-z_][a-z0-9_]{0,62}$/` then `CREATE SCHEMA IF NOT EXISTS`, a first `ping` wrapped as `Cannot connect to Postgres: ${message}` (end the pool on failure), then `migrate`. Point `openDatabase`'s postgres branch at it. Add the Postgres backend to `tests/helpers/backends.ts`: when `BOTMARKET_TEST_DATABASE_URL` is set, `open` creates `test_${randomBytes(4).toString('hex')}` and `dispose` runs `DROP SCHEMA <name> CASCADE` through a second short-lived connection (or the same pool before `close`), then closes.

- [ ] **Step 4: Run** `BOTMARKET_TEST_DATABASE_URL=<url> npm test` — expected: every contract suite runs twice (`sqlite` and `postgres`) and passes; `npm test` without the variable still passes.

- [ ] **Step 5: CI** — in `.github/workflows/ci.yml` add to the `test` job:

```yaml
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: botmarket
          POSTGRES_PASSWORD: botmarket
          POSTGRES_DB: botmarket_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U botmarket" --health-interval 5s --health-timeout 5s --health-retries 10
```

and `env: BOTMARKET_TEST_DATABASE_URL: postgres://botmarket:botmarket@localhost:5432/botmarket_test` on the `npm test` step.

- [ ] **Step 6: Run** `npm run typecheck && npm test` — expected: clean, green.

- [ ] **Step 7: Commit** `feat(db): postgres backend selected by DATABASE_URL`.

---

### Task 4: Status endpoint, healthz and admin indicator

**Files:**
- Create: `src/version.ts`, `tests/status.test.ts`
- Modify: `src/routes/api.ts`, `src/routes/admin.tsx`, `docs/api.md`

**Interfaces:**
- Consumes: `repo.driver`, `repo.ping()` (Task 2).
- Produces: `VERSION: string` (`src/version.ts`); `GET /api/status`; new `/healthz` body.

- [ ] **Step 1: Write the failing tests** in `tests/status.test.ts` (build the app with `createApp({ repo, config })` over `openSqliteDatabase(':memory:')`, like `tests/app.test.ts` does):

```ts
it("GET /api/status reports the driver and version", async () => {
  const res = await app.request("/api/status");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ version: VERSION, database: { driver: "sqlite", ok: true } });
});
it("GET /healthz reports the driver", async () => {
  const res = await app.request("/healthz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, database: { driver: "sqlite", ok: true } });
});
it("answers 503 when the database ping fails", async () => {
  const broken = Object.create(repo) as BotsRepo;
  broken.ping = () => Promise.reject(new Error("connection refused"));
  const app2 = createApp({ repo: broken, config });
  const status = await app2.request("/api/status");
  expect(status.status).toBe(503);
  expect(await status.json()).toEqual({ version: VERSION, database: { driver: "sqlite", ok: false } });
  const health = await app2.request("/healthz");
  expect(health.status).toBe(503);
  expect(await health.json()).toEqual({ ok: false, database: { driver: "sqlite", ok: false } });
  expect(await status.text().catch(() => "")).not.toContain("connection refused");
});
it("VERSION matches package.json", () => {
  expect(VERSION).toBe(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
});
```

Add to `tests/admin.test.ts`: the dashboard HTML contains `Database: sqlite`.

- [ ] **Step 2: Run** `npx vitest run tests/status.test.ts tests/admin.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement** `src/version.ts` (`createRequire(import.meta.url)('../package.json').version as string`), the two routes in `src/routes/api.ts` sharing one `databaseStatus(repo)` helper that returns `{ driver, ok }` (catching the ping error without exposing it), `Cache-Control: no-store` on `/api/status`, and the `Database: <driver>` text in the admin dashboard header. Document both endpoints in `docs/api.md` (replace the `/healthz` section; add `GET /api/status` with both bodies and the 503 case).

- [ ] **Step 4: Run** `npm run typecheck && npm test` — expected: PASS.

- [ ] **Step 5: Commit** `feat(api): /api/status and /healthz report the database driver`.

---

### Task 5: Operator documentation and compose override

**Files:**
- Create: `docker-compose.postgres.yml`
- Modify: `README.md`, `src/index.ts` (USAGE text only)

**Interfaces:**
- Consumes: the behaviour specified in Tasks 1, 3 and 4.

- [ ] **Step 1: Write** `docker-compose.postgres.yml`:

```yaml
services:
  botmarket:
    environment:
      DATABASE_URL: postgres://botmarket:botmarket@postgres:5432/botmarket
    depends_on:
      postgres:
        condition: service_healthy
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: botmarket
      POSTGRES_PASSWORD: botmarket
      POSTGRES_DB: botmarket
    volumes:
      - botmarket-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U botmarket -d botmarket"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped
volumes:
  botmarket-postgres:
```

- [ ] **Step 2: Verify** `docker compose -f docker-compose.yml -f docker-compose.postgres.yml config --quiet` — expected: exit 0.

- [ ] **Step 3: Write** the README **Database** section (after Quick start): SQLite default and file location; Postgres via `DATABASE_URL` or `BOTMARKET_DATABASE_URL` with an example URL; `?sslmode=require` verifies the certificate, `?sslmode=no-verify` skips it; migrations run automatically at startup and are safe with several instances; rate limits and the admin cookie salt are per process, so instances share data but not limits; check with `curl /api/status`; the compose override command. Add both variables to the environment table. Add `BOTMARKET_DATABASE_URL`/`DATABASE_URL` to the `USAGE` environment line in `src/index.ts` and to the `cli.test.ts` help assertion if one lists variables.

- [ ] **Step 4: Run** `npm test` — expected: PASS.

- [ ] **Step 5: Commit** `docs: postgres setup, compose override and status endpoint`.
