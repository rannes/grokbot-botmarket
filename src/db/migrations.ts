import type { SqlDatabase } from "./sql.js";

export interface Migration {
  version: number;
  sqlite: string;
  postgres: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    // Unchanged since the first release: existing SQLite files were created from exactly this text.
    sqlite: `
CREATE TABLE bots (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description_md TEXT NOT NULL,
  category TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_url TEXT,
  avatar_shape TEXT,
  avatar_color TEXT,
  image_url TEXT,
  template_id TEXT,
  recipe_json TEXT,
  source_url TEXT,
  homepage_url TEXT,
  status TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  install_clicks INTEGER NOT NULL DEFAULT 0,
  upvotes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_bots_status_created ON bots(status, created_at);
CREATE INDEX idx_bots_category ON bots(category);
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  UNIQUE(slug, kind, visitor_hash, day)
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
    // Same tables; bots.id is the insertion-order tiebreaker that SQLite gets from rowid.
    postgres: `
CREATE TABLE bots (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description_md TEXT NOT NULL,
  category TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_url TEXT,
  avatar_shape TEXT,
  avatar_color TEXT,
  image_url TEXT,
  template_id TEXT,
  recipe_json TEXT,
  source_url TEXT,
  homepage_url TEXT,
  status TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  install_clicks INTEGER NOT NULL DEFAULT 0,
  upvotes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  id BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX idx_bots_status_created ON bots(status, created_at);
CREATE INDEX idx_bots_category ON bots(category);
CREATE TABLE events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  UNIQUE(slug, kind, visitor_hash, day)
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
];

export async function migrate(db: SqlDatabase): Promise<void> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (await db.all<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    await db.transaction(async (tx) => {
      // Instances starting together against one Postgres apply migrations one at a time.
      if (db.driver === "postgres") await tx.run("SELECT pg_advisory_xact_lock(1651668077)");
      // Another instance may have applied it while this one waited for the lock.
      if (await tx.get("SELECT 1 FROM schema_migrations WHERE version = ?", [m.version])) return;
      await tx.exec(db.driver === "postgres" ? m.postgres : m.sqlite);
      await tx.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [
        m.version,
        new Date().toISOString(),
      ]);
    });
  }
}
