import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { BotAvatar } from './components.js';

// Favicon: a magenta pebble with two eyes, inline so no extra request (CSP img-src allows data:).
const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<path fill="#D6338A" d="M16 3c8 0 14 5 14 13 0 7-6 13-14 13S2 24 2 16C2 8 8 3 16 3z"/>' +
      '<circle cx="12" cy="14" r="2" fill="#16142B"/><circle cx="20" cy="14" r="2" fill="#16142B"/></svg>',
  );

export interface LayoutProps {
  title: string;
  description?: string;
  siteName: string;
  ogImage?: string | null;
  ogUrl?: string;
  /** Highlights the matching nav item. */
  current?: 'browse' | 'submit';
  children?: Child;
}

export function Layout({ title, description, siteName, ogImage, ogUrl, current, children }: LayoutProps) {
  const fullTitle = title === siteName ? siteName : `${title} | ${siteName}`;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{fullTitle}</title>
        {description ? <meta name="description" content={description} /> : null}
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={title} />
        {description ? <meta property="og:description" content={description} /> : null}
        {ogUrl ? <meta property="og:url" content={ogUrl} /> : null}
        {ogImage ? <meta property="og:image" content={ogImage} /> : null}
        {ogImage ? <meta name="twitter:card" content="summary_large_image" /> : null}
        <link rel="icon" href={FAVICON} />
        <link rel="stylesheet" href="/static/styles.css" />
        <script defer src="/static/app.js"></script>
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to content
        </a>
        <header class="site-head wrap">
          <a class="brand" href="/">
            <BotAvatar shape="pebble" color="magenta" name={siteName} size="xs" />
            <span>{siteName}</span>
          </a>
          <nav class="nav" aria-label="Main">
            <a href="/" aria-current={current === 'browse' ? 'page' : undefined}>
              Browse
            </a>
            <a class="nav-cta" href="/submit" aria-current={current === 'submit' ? 'page' : undefined}>
              Submit a bot
            </a>
          </nav>
        </header>
        <main id="main" class="wrap">
          {children}
        </main>
        <footer class="site-foot wrap">
          <p>Not affiliated with xAI or Cursor. Grok Bot is a trademark of its owner.</p>
          <p>
            <a href="/catalog.json">Catalog JSON</a>
          </p>
        </footer>
      </body>
    </html>
  );
}

/** Render a full HTML document with a doctype. */
export async function sendPage(c: Context, node: Child, status: ContentfulStatusCode = 200): Promise<Response> {
  const body = await node;
  return c.html(`<!doctype html>${String(body)}`, status);
}

export function NotFoundPage({ siteName }: { siteName: string }) {
  return (
    <Layout title="Not found" siteName={siteName}>
      <section class="page-head lost">
        <BotAvatar shape="teardrop" color="gray" name="lost" size="lg" sleepy />
        <div>
          <h1>Nothing lives here</h1>
          <p class="lede">This page doesn’t exist, or the bot was taken down.</p>
          <p>
            <a class="btn btn-primary" href="/">
              Browse bots
            </a>
          </p>
        </div>
      </section>
    </Layout>
  );
}

export function MessagePage({
  siteName,
  title,
  children,
}: {
  siteName: string;
  title: string;
  children?: Child;
}) {
  return (
    <Layout title={title} siteName={siteName}>
      <section class="page-head message">
        <h1>{title}</h1>
        {children}
      </section>
    </Layout>
  );
}
