import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./migrations.js";

export function openDatabase(path: string): DatabaseSync {
  const memory = path === ":memory:";
  if (!memory) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (!memory) db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  migrate(db);
  return db;
}
