export type Driver = "sqlite" | "postgres";
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
