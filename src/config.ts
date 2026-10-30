import { join } from "node:path";

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  adminToken: string | null;
  requireApproval: boolean;
  siteName: string;
  publicUrl: string | null;
  /** Seed the database with seed/catalog.json when it is empty. */
  seed: boolean;
  /**
   * Trust x-forwarded-for / x-forwarded-host / x-forwarded-proto (BOTMARKET_TRUST_PROXY).
   * Only enable behind a reverse proxy that overwrites these headers.
   */
  trustProxy: boolean;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = nonEmpty(env.BOTMARKET_DATA_DIR) ?? "./data";
  const publicUrl = nonEmpty(env.BOTMARKET_PUBLIC_URL);
  return {
    port: parsePort(env.PORT, 3000),
    dataDir,
    dbPath: join(dataDir, "botmarket.sqlite"),
    adminToken: nonEmpty(env.BOTMARKET_ADMIN_TOKEN),
    requireApproval: parseBool(env.BOTMARKET_REQUIRE_APPROVAL, false),
    siteName: nonEmpty(env.BOTMARKET_SITE_NAME) ?? "BotMarket",
    publicUrl: publicUrl ? publicUrl.replace(/\/+$/, "") : null,
    seed: parseBool(env.BOTMARKET_SEED, true),
    trustProxy: parseBool(env.BOTMARKET_TRUST_PROXY, false),
  };
}
