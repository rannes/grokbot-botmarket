import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BotsRepo } from '../src/db/bots-repo.js';
import type { SqlDatabase } from '../src/db/sql.js';
import { parseCatalog } from '../src/core/catalog.js';
import { DEFAULT_SEED_PATH, seedIfEmpty } from '../src/db/seed.js';
import { testBackends } from './helpers/backends.js';

describe('seed catalog', () => {
  it('is a valid catalog with 10 bots', () => {
    const r = parseCatalog(JSON.parse(readFileSync(DEFAULT_SEED_PATH, 'utf8')));
    if (!r.ok) throw new Error(r.errors.join('; '));
    expect(r.catalog.bots).toHaveLength(10);
  });
});

describe.each(testBackends())('seedIfEmpty ($driver)', (backend) => {
  let db: SqlDatabase;
  let repo: BotsRepo;
  beforeEach(async () => {
    db = await backend.open();
    repo = new BotsRepo(db);
  });
  afterEach(async () => {
    await backend.dispose(db);
  });

  it('seeds an empty repo once and is a no-op afterwards', async () => {
    expect(await seedIfEmpty(repo, DEFAULT_SEED_PATH)).toEqual({ seeded: 10 });
    expect(await repo.count({ status: 'all' })).toBe(10);
    expect(await repo.count({ featured: true, status: 'all' })).toBe(2);
    expect(await seedIfEmpty(repo, DEFAULT_SEED_PATH)).toEqual({ seeded: 0 });
    expect(await repo.count({ status: 'all' })).toBe(10);
  });

  it('names the file when the catalog is invalid', async () => {
    await expect(seedIfEmpty(repo, new URL('../package.json', import.meta.url).pathname)).rejects.toThrow(/package\.json/);
  });
});
