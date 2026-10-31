import { Hono } from 'hono';
import { buildRecipeInstallPrompt } from '../core/install-prompt.js';
import { promptDeepLink, templateDeepLink, templatePageUrl } from '../core/template-link.js';
import { visitorHash } from '../db/visitor.js';
import { resolveDeps, type AppDeps } from '../deps.js';
import { clientIp, recipeJsonUrl, requestOrigin } from './shared.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function badgeSvg(): string {
  const left = 'Grok Bot';
  const right = 'Add to Grok Bot';
  const label = `${left}: ${right}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="20" role="img" aria-label="${esc(label)}">` +
    `<title>${esc(label)}</title>` +
    `<clipPath id="r"><rect width="150" height="20" rx="3"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="52" height="20" fill="#1f2328"/><rect x="52" width="98" height="20" fill="#e5484d"/></g>` +
    `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="10" text-anchor="middle">` +
    `<text x="26" y="14">${esc(left)}</text><text x="101" y="14">${esc(right)}</text></g></svg>`
  );
}

export function installRoutes(deps: AppDeps): Hono {
  const d = resolveDeps(deps);
  const app = new Hono();

  app.get('/add/:slug', async (c) => {
    const slug = c.req.param('slug');
    const bot = await d.repo.get(slug);
    if (!bot || bot.status !== 'published') return c.json({ error: 'not found' }, 404);
    await d.repo.recordEvent(slug, 'install', visitorHash(clientIp(c), d.salt, d.now()));
    c.header('Cache-Control', 'no-store');
    if (bot.templateId) {
      return c.redirect(c.req.query('via') === 'web' ? templatePageUrl(bot.templateId) : templateDeepLink(bot.templateId), 302);
    }
    try {
      const prompt = buildRecipeInstallPrompt({ recipeUrl: recipeJsonUrl(requestOrigin(c, d.config), slug), name: bot.name });
      return c.redirect(promptDeepLink(prompt), 302);
    } catch (err) {
      if (err instanceof RangeError) return c.json({ error: 'install link unavailable' }, 500);
      throw err;
    }
  });

  app.get('/badge/:file', async (c) => {
    const file = c.req.param('file');
    if (!file.endsWith('.svg')) return c.json({ error: 'not found' }, 404);
    const bot = await d.repo.get(file.slice(0, -4));
    if (!bot || bot.status !== 'published') return c.json({ error: 'not found' }, 404);
    return c.body(badgeSvg(), 200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    });
  });

  return app;
}
