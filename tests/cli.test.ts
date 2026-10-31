import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/index.js';
import { DEFAULT_SEED_PATH } from '../src/db/seed.js';
import { parseCatalog } from '../src/core/catalog.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botmarket-cli-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function io(env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), env } };
}

describe('runCli', () => {
  it('validate: valid recipe exits 0 and prints OK', async () => {
    const f = join(dir, 'r.json');
    writeFileSync(f, JSON.stringify({ profile: { name: 'Bot', description: 'd' }, memory: ['a'], skills: [{ name: 's', content: 'c' }] }));
    const t = io();
    expect(await runCli(['validate', f], t.io)).toBe(0);
    expect(t.out.join('')).toContain('OK: Bot');
    expect(t.out.join('')).toContain('1 memories, 1 skills, 0 routines, 0 plugins');
  });

  it('validate: invalid recipe exits 1', async () => {
    const f = join(dir, 'bad.json');
    writeFileSync(f, '{"nope":true}');
    const t = io();
    expect(await runCli(['validate', f], t.io)).toBe(1);
    expect(t.err.join('')).toContain('profile');
  });

  it('unknown command exits 2 with usage', async () => {
    const t = io();
    expect(await runCli(['nope'], t.io)).toBe(2);
    expect(t.err.join('')).toContain('Usage');
  });

  it('help exits 0', async () => {
    const t = io();
    expect(await runCli(['--help'], t.io)).toBe(0);
    expect(t.out.join('')).toContain('Usage');
  });

  it('help lists the database URL variables', async () => {
    const t = io();
    expect(await runCli(['help'], t.io)).toBe(0);
    expect(t.out.join('')).toContain('BOTMARKET_DATABASE_URL, DATABASE_URL');
  });

  it('import then export round-trips the seed catalog', async () => {
    const env = { BOTMARKET_DATA_DIR: join(dir, 'data') };
    const a = io(env);
    expect(await runCli(['import', DEFAULT_SEED_PATH], a.io)).toBe(0);
    expect(a.out.join('')).toContain('Imported 10 bots');
    const out = join(dir, 'out.json');
    const b = io(env);
    expect(await runCli(['export', out], b.io)).toBe(0);
    const r = parseCatalog(JSON.parse(readFileSync(out, 'utf8')));
    if (!r.ok) throw new Error(r.errors.join('; '));
    expect(r.catalog.bots).toHaveLength(10);
  });

  it('missing arguments exit 2', async () => {
    for (const c of ['validate', 'import']) {
      const t = io();
      expect(await runCli([c], t.io)).toBe(2);
      expect(t.err.join('')).toContain('missing');
    }
  });

  it('unreadable file and non-JSON input exit 1', async () => {
    const env = { BOTMARKET_DATA_DIR: join(dir, 'data') };
    const bad = join(dir, 'x.json');
    writeFileSync(bad, 'not json');
    for (const argv of [['validate', join(dir, 'nope.json')], ['import', join(dir, 'nope.json')], ['import', bad], ['validate', bad]]) {
      const t = io(env);
      expect(await runCli(argv, t.io)).toBe(1);
      expect(t.err.join('')).not.toBe('');
    }
  });

  it('import rejects http URLs', async () => {
    const t = io({ BOTMARKET_DATA_DIR: join(dir, 'data') });
    expect(await runCli(['import', 'http://example.com/c.json'], t.io)).toBe(1);
    expect(t.err.join('')).toContain('https');
  });

  it('serve exits 1 without echoing the url when Postgres is unreachable', async () => {
    const t = io({ DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:1/db' });
    expect(await runCli(['serve'], t.io)).toBe(1);
    expect(t.err.join('')).toContain('Cannot connect to Postgres');
    expect(t.err.join('')).not.toContain('hunter2');
  });

  it('export without a file writes the catalog to stdout', async () => {
    const env = { BOTMARKET_DATA_DIR: join(dir, 'data') };
    await runCli(['import', DEFAULT_SEED_PATH], io(env).io);
    const t = io(env);
    expect(await runCli(['export'], t.io)).toBe(0);
    const r = parseCatalog(JSON.parse(t.out.join('')));
    expect(r.ok && r.catalog.bots.length).toBe(10);
  });
});
