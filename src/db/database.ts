import type { Config } from "../config.js";
import { openPostgresDatabase } from "./postgres.js";
import type { SqlDatabase } from "./sql.js";

/** Opens (and migrates) the database the config selects. */
export async function openDatabase(
  config: Pick<Config, "databaseDriver" | "databaseUrl" | "dbPath">,
): Promise<SqlDatabase> {
  if (config.databaseDriver === "postgres") {
    if (config.databaseUrl === null) throw new Error("The postgres driver needs a database URL");
    return openPostgresDatabase(config.databaseUrl);
  }
  const { openSqliteDatabase } = await import("./sqlite.js");
  return openSqliteDatabase(config.dbPath);
}
