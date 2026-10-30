import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.js";

export function openDatabase(path: string): DatabaseSync {
  const memory = path === ":memory:";
  if (!memory) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Wait up to 5 s for a lock (e.g. a CLI import or backup running alongside the server) instead of failing with SQLITE_BUSY.
  db.exec("PRAGMA busy_timeout = 5000");
  if (!memory) db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  migrate(db);
  return db;
}
