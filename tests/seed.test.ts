import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/db/database.js';
import { BotsRepo } from '../src/db/bots-repo.js';
import { parseCatalog } from '../src/core/catalog.js';
import { DEFAULT_SEED_PATH, seedIfEmpty } from '../src/db/seed.js';

describe('seed catalog', () => {
  it('is a valid catalog with 10 bots', () => {
    const r = parseCatalog(JSON.parse(readFileSync(DEFAULT_SEED_PATH, 'utf8')));
    if (!r.ok) throw new Error(r.errors.join('; '));
    expect(r.catalog.bots).toHaveLength(10);
  });

  it('seeds an empty repo once and is a no-op afterwards', () => {
    const repo = new BotsRepo(openDatabase(':memory:'));
    expect(seedIfEmpty(repo, DEFAULT_SEED_PATH)).toEqual({ seeded: 10 });
    expect(repo.count({ status: 'all' })).toBe(10);
    expect(repo.count({ featured: true, status: 'all' })).toBe(2);
    expect(seedIfEmpty(repo, DEFAULT_SEED_PATH)).toEqual({ seeded: 0 });
    expect(repo.count({ status: 'all' })).toBe(10);
  });

  it('names the file when the catalog is invalid', () => {
    const repo = new BotsRepo(openDatabase(':memory:'));
    expect(() => seedIfEmpty(repo, new URL('../package.json', import.meta.url).pathname)).toThrow(/package\.json/);
  });
});
