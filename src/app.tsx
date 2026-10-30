import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { resolveDeps, type AppDeps } from './deps.js';
import { adminRoutes } from './routes/admin.js';
import { apiRoutes } from './routes/api.js';
import { installRoutes } from './routes/install.js';
import { pagesRoutes } from './routes/pages.js';
import { submitRoutes } from './routes/submit.js';
import { avatarColorCss } from './views/components.js';
import { MessagePage, NotFoundPage, sendPage } from './views/layout.js';

const CSP = [
  "default-src 'self'",
  "img-src 'self' https: data:",
  "style-src 'self'",
  "script-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Read once at startup. The build copies src/public to dist/public, so this resolves in dev and prod.
const STYLES = `${readFileSync(new URL('./public/styles.css', import.meta.url), 'utf8')}\n${avatarColorCss()}`;
const SCRIPT = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const STATIC_CACHE = 'public, max-age=3600';

export function createApp(deps: AppDeps): Hono {
  const d = resolveDeps(deps);
  const siteName = d.config.siteName;
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('Content-Security-Policy', CSP);
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  app.get('/static/styles.css', (c) =>
    c.body(STYLES, 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': STATIC_CACHE }),
  );
  app.get('/static/app.js', (c) =>
    c.body(SCRIPT, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': STATIC_CACHE }),
  );

  app.route('/', pagesRoutes(d));
  app.route('/', submitRoutes(d));
  app.route('/', installRoutes(d));
  app.route('/', apiRoutes(d));
  app.route('/', adminRoutes(d));

  app.notFound((c) => sendPage(c, <NotFoundPage siteName={siteName} />, 404));
  app.onError((err, c) => {
    console.error(err);
    return sendPage(
      c,
      <MessagePage siteName={siteName} title="Something broke">
        <p class="lede">The server hit an error. Try again in a moment.</p>
      </MessagePage>,
      500,
    );
  });

  return app;
}
