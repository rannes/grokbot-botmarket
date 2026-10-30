import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalogBotToNewBot, parseCatalog } from '../core/catalog.js';
import type { BotsRepo } from './bots-repo.js';

/** seed/ sits at the repo root next to src/ and dist/, so this resolves from both. */
export const DEFAULT_SEED_PATH = fileURLToPath(new URL('../../seed/catalog.json', import.meta.url));

const FEATURED_COUNT = 2;

export function seedIfEmpty(repo: BotsRepo, catalogPath: string): { seeded: number } {
  if (repo.count({ status: 'all' }) > 0) return { seeded: 0 };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read seed catalog ${catalogPath}: ${(e as Error).message}`);
  }
  const parsed = parseCatalog(raw);
  if (!parsed.ok) {
    throw new Error(`Invalid seed catalog ${catalogPath}: ${parsed.errors.slice(0, 3).join('; ')}`);
  }
  parsed.catalog.bots.forEach((cb, i) => {
    repo.upsertFromCatalog({ ...catalogBotToNewBot(cb), featured: i < FEATURED_COUNT });
  });
  return { seeded: parsed.catalog.bots.length };
}
