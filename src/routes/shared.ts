import type { Context } from 'hono';
import type { Config } from '../config.js';

const HOST_RE = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

const firstValue = (v: string | undefined): string => v?.split(',')[0]?.trim() ?? '';

/**
 * Absolute origin for links that leave the page (og:url, recipe URLs, badges).
 * Prefers config.publicUrl; otherwise trusts proxy headers, so set BOTMARKET_PUBLIC_URL behind a proxy.
 */
export function requestOrigin(c: Context, config: Pick<Config, 'publicUrl'>): string {
  if (config.publicUrl) return config.publicUrl;
  const url = new URL(c.req.url);
  const proto = firstValue(c.req.header('x-forwarded-proto')).toLowerCase();
  const scheme = proto === 'http' || proto === 'https' ? proto : url.protocol.replace(/:$/, '');
  const host = firstValue(c.req.header('x-forwarded-host')) || firstValue(c.req.header('host'));
  if (host && HOST_RE.test(host)) return `${scheme}://${host}`;
  return url.origin;
}

/** First hop of x-forwarded-for, else the socket address (node-server), else 'unknown'. */
export function clientIp(c: Context): string {
  const forwarded = firstValue(c.req.header('x-forwarded-for'));
  if (forwarded) return forwarded;
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

export function recipeJsonUrl(origin: string, slug: string): string {
  return `${origin}/api/bots/${encodeURIComponent(slug)}/recipe.json`;
}
