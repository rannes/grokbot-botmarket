#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { exportCatalog, catalogBotToNewBot, parseCatalog } from './core/catalog.js';
import { parseRecipeText, recipeCounts } from './core/recipe.js';
import { loadConfig } from './config.js';
import { BotsRepo, type Bot } from './db/bots-repo.js';
import { openDatabase } from './db/database.js';
import { startServer } from './server.js';

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: NodeJS.ProcessEnv;
}

const USAGE = `Usage: botmarket [command]

Commands:
  serve                  Start the web server (default)
  import <url-or-file>   Import a botmarket-catalog/v1 catalog (https URL or local file)
  export [file]          Export published bots as a catalog (stdout if no file)
  validate <recipe.json> Validate a Grok Bot recipe file
  help, --help, -h       Show this help

Environment: PORT, HOST, BOTMARKET_DATA_DIR, BOTMARKET_ADMIN_TOKEN, BOTMARKET_REQUIRE_APPROVAL,
BOTMARKET_SITE_NAME, BOTMARKET_PUBLIC_URL, BOTMARKET_SEED
`;

async function readSource(src: string): Promise<string> {
  if (/^https?:\/\//i.test(src)) {
    if (!src.toLowerCase().startsWith('https://')) throw new Error('only https URLs are supported');
    const res = await fetch(src, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${src}`);
    return await res.text();
  }
  return readFileSync(src, 'utf8');
}

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  const [cmd = 'serve', ...rest] = argv;
  try {
    switch (cmd) {
      case 'help':
      case '--help':
      case '-h':
        io.stdout(USAGE);
        return 0;

      case 'serve': {
        await startServer(loadConfig(io.env));
        return -1; // keep running
      }

      case 'import': {
        const src = rest[0];
        if (!src) { io.stderr('import: missing <url-or-file>\n'); return 2; }
        let json: unknown;
        try { json = JSON.parse(await readSource(src)); } catch (e) {
          io.stderr(`import: cannot read ${src}: ${(e as Error).message}\n`);
          return 1;
        }
        const parsed = parseCatalog(json);
        if (!parsed.ok) {
          io.stderr(`import: invalid catalog:\n${parsed.errors.map((e) => `  ${e}`).join('\n')}\n`);
          return 1;
        }
        const db = openDatabase(loadConfig(io.env).dbPath);
        try {
          const repo = new BotsRepo(db);
          for (const cb of parsed.catalog.bots) repo.upsertFromCatalog(catalogBotToNewBot(cb));
        } finally { db.close(); }
        io.stdout(`Imported ${parsed.catalog.bots.length} bots\n`);
        return 0;
      }

      case 'export': {
        const config = loadConfig(io.env);
        const db = openDatabase(config.dbPath);
        let bots: Bot[] = [];
        try {
          const repo = new BotsRepo(db);
          for (let offset = 0; ; offset += 100) {
            const page = repo.list({ status: 'published', limit: 100, offset });
            bots.push(...page);
            if (page.length < 100) break;
          }
        } finally { db.close(); }
        const text = JSON.stringify(exportCatalog(bots, { name: config.siteName, url: config.publicUrl }), null, 2) + '\n';
        if (rest[0]) {
          writeFileSync(rest[0], text);
          io.stdout(`Exported ${bots.length} bots to ${rest[0]}\n`);
        } else io.stdout(text);
        return 0;
      }

      case 'validate': {
        const file = rest[0];
        if (!file) { io.stderr('validate: missing <recipe.json>\n'); return 2; }
        let text: string;
        try { text = readFileSync(file, 'utf8'); } catch (e) {
          io.stderr(`validate: cannot read ${file}: ${(e as Error).message}\n`);
          return 1;
        }
        const r = parseRecipeText(text);
        if (!r.ok) {
          io.stderr(`Invalid recipe:\n${r.errors.map((e) => `  ${e}`).join('\n')}\n`);
          return 1;
        }
        const c = recipeCounts(r.recipe);
        io.stdout(`OK: ${r.recipe.profile.name} — ${c.memory} memories, ${c.skills} skills, ${c.routines} routines, ${c.plugins} plugins\n`);
        return 0;
      }

      default:
        io.stderr(`Unknown command: ${cmd}\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    io.stderr(`${(e as Error).message}\n`);
    return 1;
  }
}

function isMain(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    env: process.env,
  });
  if (code >= 0) process.exit(code);
}

if (isMain()) void main();
