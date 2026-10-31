import type { Config } from "../config.js";
import type { SqlDatabase } from "./sql.js";
import { openSqliteDatabase } from "./sqlite.js";

/** Opens (and migrates) the database the config selects. */
export async function openDatabase(
  config: Pick<Config, "databaseDriver" | "databaseUrl" | "dbPath">,
): Promise<SqlDatabase> {
  if (config.databaseDriver === "postgres") throw new Error("Postgres driver is added in Task 3");
  return openSqliteDatabase(config.dbPath);
}
