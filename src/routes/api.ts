import { Hono } from 'hono';
import { exportCatalog, toCatalogBot } from '../core/catalog.js';
import { isCategory } from '../core/categories.js';
import { botFromInput } from '../core/validation.js';
import type { Bot } from '../db/bots-repo.js';
import { visitorHash } from '../db/visitor.js';
import { resolveDeps, type AppDeps } from '../deps.js';
import { clientIp, requestOrigin } from './shared.js';

const SORTS = ['new', 'top', 'installs'] as const;
type Sort = (typeof SORTS)[number];

function intParam(v: string | undefined, def: number, min: number, max: number): number | null {
  if (v === undefined || v === '') return def;
  if (!/^\d+$/.test(v)) return null;
  return Math.min(max, Math.max(min, Number(v)));
}

export function apiRoutes(deps: AppDeps): Hono {
  const d = resolveDeps(deps);
  const app = new Hono();
  const published = (slug: string): Bot | null => {
    const bot = d.repo.get(slug);
    return bot && bot.status === 'published' ? bot : null;
  };

  app.get('/api/bots', (c) => {
    const { q, category, sort } = c.req.query();
    if (category !== undefined && category !== '' && !isCategory(category)) return c.json({ error: 'invalid category' }, 400);
    if (sort !== undefined && sort !== '' && !(SORTS as readonly string[]).includes(sort)) return c.json({ error: 'invalid sort' }, 400);
    const limit = intParam(c.req.query('limit'), 50, 1, 100);
    const offset = intParam(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    if (limit === null || offset === null) return c.json({ error: 'invalid limit or offset' }, 400);
    const filter = {
      status: 'published' as const,
      ...(category ? { category: category as never } : {}),
      ...(q ? { q } : {}),
    };
    const bots = d.repo.list({ ...filter, sort: (sort || 'new') as Sort, limit, offset });
    return c.json({ bots: bots.map(toCatalogBot), total: d.repo.count(filter) });
  });

  app.post('/api/bots', async (c) => {
    if (!d.submitLimiter.allow(clientIp(c))) return c.json({ error: 'rate limited' }, 429);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ errors: ['body must be valid JSON'] }, 400);
    }
    const parsed = botFromInput(body);
    if (!parsed.ok) return c.json({ errors: parsed.errors }, 400);
    const bot = d.repo.insert({ ...parsed.bot, status: d.config.requireApproval ? 'pending' : 'published' });
    return c.json({ ...toCatalogBot(bot), status: bot.status }, 201, { Location: `/bots/${bot.slug}` });
  });

  app.get('/api/bots/:slug/recipe.json', (c) => {
    const bot = published(c.req.param('slug'));
    if (!bot || !bot.recipe) return c.json({ error: 'not found' }, 404);
    return c.json(bot.recipe, 200, { 'Content-Disposition': `inline; filename="${bot.slug}.recipe.json"` });
  });

  app.post('/api/bots/:slug/upvote', (c) => {
    const slug = c.req.param('slug');
    if (!published(slug)) return c.json({ error: 'not found' }, 404);
    const counted = d.repo.recordEvent(slug, 'upvote', visitorHash(clientIp(c), d.salt, d.now()));
    const fresh = d.repo.get(slug);
    return c.json({ upvotes: fresh?.upvotes ?? 0, counted });
  });

  app.get('/api/bots/:slug', (c) => {
    const bot = published(c.req.param('slug'));
    if (!bot) return c.json({ error: 'not found' }, 404);
    return c.json(toCatalogBot(bot));
  });

  app.get('/catalog.json', (c) => {
    const all: Bot[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = d.repo.list({ status: 'published', sort: 'new', limit: 100, offset });
      all.push(...page);
      if (page.length < 100) break;
    }
    const catalog = exportCatalog(all, { name: d.config.siteName, url: d.config.publicUrl ?? requestOrigin(c, d.config) }, d.now);
    return c.json(catalog, 200, { 'Cache-Control': 'public, max-age=300' });
  });

  app.get('/healthz', (c) => c.json({ ok: true }));

  return app;
}
