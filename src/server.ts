import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import type { Config } from './config.js';
import { BotsRepo } from './db/bots-repo.js';
import { openDatabase } from './db/database.js';
import { DEFAULT_SEED_PATH, seedIfEmpty } from './db/seed.js';

export interface StartedServer {
  port: number;
  close(): Promise<void>;
}

export async function startServer(
  config: Config,
  opts: { seedPath?: string; quiet?: boolean } = {},
): Promise<StartedServer> {
  const db = openDatabase(config.dbPath);
  try {
    const repo = new BotsRepo(db);
    if (config.seed) {
      const { seeded } = seedIfEmpty(repo, opts.seedPath ?? DEFAULT_SEED_PATH);
      if (seeded > 0 && !opts.quiet) console.log(`Seeded ${seeded} bots`);
    }
    const app = createApp({ repo, config });
    const hostname = process.env.HOST ?? '0.0.0.0';
    return await new Promise<StartedServer>((resolve, reject) => {
      const server = serve({ fetch: app.fetch, port: config.port, hostname }, (info: AddressInfo) => {
        if (!opts.quiet) console.log(`BotMarket listening on http://localhost:${info.port}`);
        resolve({
          port: info.port,
          close: () =>
            new Promise<void>((res, rej) => {
              server.close((err) => {
                try { db.close(); } catch { /* already closed */ }
                err ? rej(err) : res();
              });
              (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
            }),
        });
      });
      server.once('error', reject);
    });
  } catch (e) {
    try { db.close(); } catch { /* ignore */ }
    throw e;
  }
}
