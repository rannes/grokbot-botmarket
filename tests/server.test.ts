import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import type { Config } from '../src/config.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botmarket-srv-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const cfg = (port: number, seed = true): Config => ({
  port, dataDir: dir, dbPath: join(dir, 'b.sqlite'), adminToken: null, requireApproval: false,
  siteName: 'T', publicUrl: null, trustProxy: false, seed,
});

describe('startServer', () => {
  it('listens on an ephemeral port, serves, and releases the port on close', async () => {
    const s = await startServer(cfg(0), { quiet: true });
    expect(s.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${s.port}/healthz`);
    expect(res.status).toBe(200);
    await s.close();
    await expect(fetch(`http://127.0.0.1:${s.port}/healthz`)).rejects.toThrow();
  });

  it('rejects when the port is taken and still allows a later start', async () => {
    const a = await startServer(cfg(0), { quiet: true });
    await expect(startServer({ ...cfg(a.port), dbPath: join(dir, 'c.sqlite') }, { quiet: true })).rejects.toThrow();
    await a.close();
  });

  it('rejects on an invalid seed file', async () => {
    await expect(startServer(cfg(0), { quiet: true, seedPath: join(dir, 'missing.json') })).rejects.toThrow(/missing\.json/);
  });
});
