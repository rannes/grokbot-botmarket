import type { DatabaseSync } from "node:sqlite";

export const MIGRATIONS: string[] = [
  `
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
];

export function migrate(db: DatabaseSync): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  });
}
