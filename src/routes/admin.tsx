import { Hono, type Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { ADMIN_COOKIE, hasBearerAdmin, isAdminRequest, signAdminCookie } from '../core/admin-auth.js';
import { catalogBotToNewBot, parseCatalog } from '../core/catalog.js';
import { resolveDeps, type AppDeps } from '../deps.js';
import type { Bot } from '../db/bots-repo.js';
import { Layout, NotFoundPage, sendPage } from '../views/layout.js';
import { botPath } from '../views/components.js';
import { requestOrigin } from './shared.js';

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const LIST_LIMIT = 100; // repo.list caps at 100

function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

function ActionForm({ slug, action, label, danger }: { slug: string; action: string; label: string; danger?: boolean }) {
  return (
    <form method="post" action={`/admin/bots/${encodeURIComponent(slug)}/${action}`} style="display:inline">
      <button type="submit" class={danger ? 'btn btn-danger' : 'btn'}>
        {label}
      </button>
    </form>
  );
}

function BotRow({ bot }: { bot: Bot }) {
  return (
    <li style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;padding:.4rem 0">
      <a href={botPath(bot.slug)}>{bot.name}</a>
      <span class="muted">by {bot.authorName}</span>
      {bot.featured ? <strong>featured</strong> : null}
      <span style="margin-left:auto">
        {bot.status === 'pending' ? (
          <ActionForm slug={bot.slug} action="approve" label="Approve" />
        ) : bot.featured ? (
          <ActionForm slug={bot.slug} action="unfeature" label="Unfeature" />
        ) : (
          <ActionForm slug={bot.slug} action="feature" label="Feature" />
        )}{' '}
        <ActionForm slug={bot.slug} action="delete" label="Delete" danger />
      </span>
    </li>
  );
}

function LoginPage({ siteName, error }: { siteName: string; error?: string }) {
  return (
    <Layout title="Admin login" siteName={siteName}>
      <section class="page-head message">
        <h1>Admin login</h1>
        {error ? <p role="alert">{error}</p> : null}
        <form method="post" action="/admin/login">
          <label>
            Admin token <input type="password" name="token" autocomplete="current-password" required />
          </label>{' '}
          <button type="submit" class="btn btn-primary">
            Sign in
          </button>
        </form>
      </section>
    </Layout>
  );
}

function Dashboard({
  siteName,
  pending,
  published,
  pendingCount,
  publishedCount,
  notice,
  errors,
}: {
  siteName: string;
  pending: Bot[];
  published: Bot[];
  pendingCount: number;
  publishedCount: number;
  notice?: string;
  errors?: string[];
}) {
  return (
    <Layout title="Admin" siteName={siteName}>
      <section class="page-head message">
        <h1>Admin</h1>
        {notice ? <p role="status">{notice}</p> : null}
        {errors && errors.length > 0 ? (
          <div role="alert">
            <p>Import failed:</p>
            <ul>
              {errors.map((e) => (
                <li>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <form method="post" action="/admin/logout">
          <button type="submit" class="btn">
            Log out
          </button>
        </form>
      </section>
      <section>
        <h2>Pending ({pendingCount})</h2>
        {pending.length === 0 ? <p>Nothing waiting for review.</p> : <ul class="admin-list">{pending.map((b) => <BotRow bot={b} />)}</ul>}
      </section>
      <section>
        <h2>Published ({publishedCount})</h2>
        <ul class="admin-list">{published.map((b) => <BotRow bot={b} />)}</ul>
      </section>
      <section>
        <h2>Import catalog</h2>
        <form method="post" action="/admin/import">
          <label>
            Catalog URL <input type="url" name="url" placeholder="https://example.com/catalog.json" required />
          </label>{' '}
          <button type="submit" class="btn btn-primary">
            Import
          </button>
        </form>
        <p>
          <a href="/admin/export">Export catalog</a>
        </p>
      </section>
    </Layout>
  );
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) return null;
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function adminRoutes(deps: AppDeps, fetchImpl: typeof fetch = fetch): Hono {
  const d = resolveDeps(deps);
  const app = new Hono();
  const siteName = d.config.siteName;

  app.use('/admin', gate);
  app.use('/admin/*', gate);

  async function gate(c: Context, next: () => Promise<void>): Promise<Response | void> {
    if (!d.config.adminToken) return sendPage(c, <NotFoundPage siteName={siteName} />, 404);
    await next();
  }

  /** CSRF guard for cookie-authenticated state changes. */
  function csrfOk(c: Context): boolean {
    if (hasBearerAdmin(c, d)) return true;
    if (c.req.header('sec-fetch-site') === 'cross-site') return false;
    const origin = c.req.header('origin');
    if (origin) {
      const allowed = new Set([new URL(c.req.url).origin, requestOrigin(c, { publicUrl: null })]);
      if (!allowed.has(origin)) return false;
    }
    return true;
  }

  async function dashboard(c: Context, status: 200 | 400, extra: { notice?: string; errors?: string[] } = {}) {
    const pending = d.repo.list({ status: 'pending', sort: 'new', limit: LIST_LIMIT });
    const published = d.repo.list({ status: 'published', sort: 'new', limit: LIST_LIMIT });
    return sendPage(
      c,
      <Dashboard
        siteName={siteName}
        pending={pending}
        published={published}
        pendingCount={d.repo.count({ status: 'pending' })}
        publishedCount={d.repo.count({ status: 'published' })}
        {...extra}
      />,
      status,
    );
  }

  /** Returns a Response when the request must not proceed. */
  function guard(c: Context): Response | null {
    if (!isAdminRequest(c, d)) return c.text('unauthorized', 401);
    if (!csrfOk(c)) return c.text('forbidden', 403);
    return null;
  }

  app.get('/admin', async (c) => {
    if (!isAdminRequest(c, d)) return sendPage(c, <LoginPage siteName={siteName} />);
    return dashboard(c, 200);
  });

  app.get('/admin/export', (c) => c.redirect('/catalog.json', 302));

  app.post('/admin/login', async (c) => {
    if (!csrfOk(c)) return c.text('forbidden', 403);
    const body = await c.req.parseBody();
    const token = typeof body.token === 'string' ? body.token : '';
    const expected = d.config.adminToken as string;
    if (!safeEqual(token, expected)) {
      return sendPage(c, <LoginPage siteName={siteName} error="Wrong token." />, 401);
    }
    setCookie(c, ADMIN_COOKIE, signAdminCookie(expected, d.salt), {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/admin',
      secure: requestOrigin(c, { publicUrl: null }).startsWith('https:'),
    });
    return c.redirect('/admin', 303);
  });

  app.post('/admin/logout', (c) => {
    if (!csrfOk(c)) return c.text('forbidden', 403);
    deleteCookie(c, ADMIN_COOKIE, { path: '/admin' });
    return c.redirect('/admin', 303);
  });

  app.post('/admin/bots/:slug/:action', async (c) => {
    const denied = guard(c);
    if (denied) return denied;
    const slug = c.req.param('slug');
    const action = c.req.param('action');
    if (!['approve', 'feature', 'unfeature', 'delete'].includes(action)) {
      return sendPage(c, <NotFoundPage siteName={siteName} />, 404);
    }
    if (!d.repo.get(slug)) return sendPage(c, <NotFoundPage siteName={siteName} />, 404);
    if (action === 'approve') d.repo.setStatus(slug, 'published');
    else if (action === 'feature') d.repo.setFeatured(slug, true);
    else if (action === 'unfeature') d.repo.setFeatured(slug, false);
    else d.repo.delete(slug);
    return c.redirect('/admin', 303);
  });

  app.post('/admin/import', async (c) => {
    const denied = guard(c);
    if (denied) return denied;
    let url = '';
    if ((c.req.header('content-type') ?? '').includes('application/json')) {
      const j = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
      url = typeof j?.url === 'string' ? j.url : '';
    } else {
      const b = await c.req.parseBody();
      url = typeof b.url === 'string' ? b.url : '';
    }
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(url.trim());
    } catch {
      parsedUrl = null;
    }
    if (!parsedUrl || parsedUrl.protocol !== 'https:') {
      return dashboard(c, 400, { errors: ['URL must be a valid https:// address.'] });
    }
    let text: string | null;
    try {
      const res = await fetchImpl(parsedUrl.toString(), {
        signal: AbortSignal.timeout(5000),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return dashboard(c, 400, { errors: [`Fetch failed with status ${res.status}.`] });
      text = await readCapped(res, MAX_IMPORT_BYTES);
    } catch {
      return dashboard(c, 400, { errors: ['Could not fetch the catalog (network error or timeout).'] });
    }
    if (text === null) return dashboard(c, 400, { errors: ['Catalog is larger than 8 MB.'] });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return dashboard(c, 400, { errors: ['Response is not valid JSON.'] });
    }
    const parsed = parseCatalog(json);
    if (!parsed.ok) return dashboard(c, 400, { errors: parsed.errors });
    let created = 0;
    let updated = 0;
    for (const cb of parsed.catalog.bots) {
      if (d.repo.get(cb.slug)) updated++;
      else created++;
      d.repo.upsertFromCatalog(catalogBotToNewBot(cb));
    }
    const n = created + updated;
    return dashboard(c, 200, {
      notice: `Imported ${n} ${n === 1 ? 'bot' : 'bots'} (${created} new, ${updated} updated).`,
    });
  });

  return app;
}
