import type { Context } from 'hono';
import type { Config } from '../config.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by createApp from config.trustProxy, so helpers called without config still honour it. */
    trustProxy: boolean;
  }
}

const HOST_RE = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

const firstValue = (v: string | undefined): string => v?.split(',')[0]?.trim() ?? '';
const lastValue = (v: string | undefined): string => v?.split(',').at(-1)?.trim() ?? '';

function trusts(c: Context, config?: Partial<Pick<Config, 'trustProxy'>>): boolean {
  return config?.trustProxy ?? c.get('trustProxy') ?? false;
}

/**
 * Absolute origin for links that leave the page (og:url, og:image, recipe URLs, badges).
 * config.publicUrl wins. Otherwise x-forwarded-proto/host are used only when trustProxy is on
 * (from config, or from the flag createApp puts on the context); else the request URL's origin.
 */
export function requestOrigin(
  c: Context,
  config: Pick<Config, 'publicUrl'> & Partial<Pick<Config, 'trustProxy'>>,
): string {
  if (config.publicUrl) return config.publicUrl;
  const url = new URL(c.req.url);
  if (!trusts(c, config)) return url.origin;
  const proto = firstValue(c.req.header('x-forwarded-proto')).toLowerCase();
  const scheme = proto === 'http' || proto === 'https' ? proto : url.protocol.replace(/:$/, '');
  const host = firstValue(c.req.header('x-forwarded-host')) || firstValue(c.req.header('host'));
  if (host && HOST_RE.test(host)) return `${scheme}://${host}`;
  return url.origin;
}

/**
 * Client address for rate limits and visitor hashes. With trustProxy on, the last hop of
 * x-forwarded-for: the address our own proxy appended (earlier hops are client-controlled with
 * appending proxies such as nginx's $proxy_add_x_forwarded_for, Caddy and Traefik). Otherwise (and
 * as a fallback) the socket address from node-server, else 'unknown'.
 */
export function clientIp(c: Context, config?: Partial<Pick<Config, 'trustProxy'>>): string {
  if (trusts(c, config)) {
    const forwarded = lastValue(c.req.header('x-forwarded-for'));
    if (forwarded) return forwarded;
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

export function recipeJsonUrl(origin: string, slug: string): string {
  return `${origin}/api/bots/${encodeURIComponent(slug)}/recipe.json`;
}

/** Largest request body accepted anywhere: a 2 MB recipe plus the other fields and form encoding. */
export const MAX_BODY_BYTES = 6 * 1024 * 1024;

export const OG_DEFAULT_PATH = '/static/og-default.png';

/** Absolute URL of the default link-preview image. */
export function defaultOgImage(origin: string): string {
  return `${origin}${OG_DEFAULT_PATH}`;
}
