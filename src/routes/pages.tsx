import { Hono } from 'hono';
import { categoryLabel, isCategory } from '../core/categories.js';
import type { Bot } from '../db/bots-repo.js';
import type { AppDeps } from '../deps.js';
import { BotDetail } from '../views/bot-detail.js';
import { BotAvatar, BotGrid, CategoryChips, EmptyState, botPath, plural } from '../views/components.js';
import { Layout, NotFoundPage, sendPage } from '../views/layout.js';
import { defaultOgImage, requestOrigin } from './shared.js';

export const PITCH = 'Bots for Grok Bot, shared by people like you. One click adds a bot to your app.';
const HOME_LIMIT = 48;
const LINEUP_SIZES = ['lg', 'xl', 'md', 'lg', 'xl', 'md'] as const;
const PLACEHOLDER_LINEUP = [
  { shape: 'pebble', color: 'magenta' },
  { shape: 'capsule', color: 'blue' },
  { shape: 'teardrop', color: 'yellow' },
  { shape: 'pebble', color: 'teal' },
  { shape: 'capsule', color: 'orange' },
  { shape: 'circle', color: 'purple' },
];

/** Hero figures: real bots (featured first) standing on a shelf; placeholders when the catalog is empty. */
function Lineup({ bots }: { bots: Bot[] }) {
  if (bots.length === 0) {
    return (
      <div class="lineup" aria-hidden="true">
        {PLACEHOLDER_LINEUP.map((p, i) => (
          <span class="figure">
            <BotAvatar shape={p.shape} color={p.color} name={p.color} size={LINEUP_SIZES[i] ?? 'md'} />
          </span>
        ))}
      </div>
    );
  }
  return (
    <div class="lineup">
      {bots.map((b, i) => (
        <a class="figure" href={botPath(b.slug)} title={b.name} aria-label={b.name}>
          <BotAvatar shape={b.avatarShape} color={b.avatarColor} name={b.name} size={LINEUP_SIZES[i] ?? 'md'} />
        </a>
      ))}
    </div>
  );
}

function SearchForm({ q = '', big = false }: { q?: string; big?: boolean }) {
  return (
    <form class={big ? 'search search-big' : 'search'} action="/search" method="get" role="search">
      <label class="sr-only" for="q">
        Search bots
      </label>
      <input id="q" type="search" name="q" value={q} maxlength={200} placeholder="Search by name, task or tag" />
      <button class="btn btn-primary" type="submit">
        Search
      </button>
    </form>
  );
}

export function pagesRoutes(deps: AppDeps): Hono {
  const { repo, config } = deps;
  const siteName = config.siteName;
  const app = new Hono();

  app.get('/', (c) => {
    const origin = requestOrigin(c, config);
    const featured = repo.list({ featured: true, limit: 6 });
    const bots = repo.list({ limit: HOME_LIMIT });
    const total = repo.count();
    const lineup = [...featured, ...bots].filter((b, i, all) => all.findIndex((x) => x.slug === b.slug) === i).slice(0, 6);
    return sendPage(
      c,
      <Layout
        title={siteName}
        description={PITCH}
        siteName={siteName}
        ogUrl={`${origin}/`}
        ogImage={defaultOgImage(origin)}
        current="browse"
      >
        <section class="hero">
          <div class="hero-text">
            <h1>{siteName}</h1>
            <p class="pitch">{PITCH}</p>
            <SearchForm big />
          </div>
          <Lineup bots={lineup} />
        </section>
        <CategoryChips counts={repo.categoryCounts()} active="all" />
        {featured.length > 0 ? (
          <section class="shelf" aria-labelledby="featured-h">
            <h2 id="featured-h">Featured</h2>
            <BotGrid bots={featured} featured />
          </section>
        ) : null}
        <section class="shelf" aria-labelledby="newest-h">
          <h2 id="newest-h">Newest</h2>
          {bots.length > 0 ? (
            <BotGrid bots={bots} />
          ) : (
            <EmptyState title="No bots yet">
              <p>Publish the first one and it shows up here.</p>
              <p>
                <a class="btn btn-primary" href="/submit">
                  Submit a bot
                </a>
              </p>
            </EmptyState>
          )}
          {total > bots.length ? (
            <p class="more">
              Showing the newest {bots.length} of {total}. Search or pick a category to find the rest.
            </p>
          ) : null}
        </section>
      </Layout>,
    );
  });

  app.get('/bots/:slug', (c) => {
    const bot = repo.get(c.req.param('slug'));
    if (!bot || bot.status !== 'published') return sendPage(c, <NotFoundPage siteName={siteName} />, 404);
    const origin = requestOrigin(c, config);
    return sendPage(
      c,
      <Layout
        title={bot.name}
        description={bot.tagline}
        siteName={siteName}
        ogUrl={`${origin}${botPath(bot.slug)}`}
        ogImage={bot.imageUrl ?? defaultOgImage(origin)}
      >
        <BotDetail bot={bot} origin={origin} />
      </Layout>,
    );
  });

  app.get('/c/:category', (c) => {
    const category = c.req.param('category');
    if (!isCategory(category)) return sendPage(c, <NotFoundPage siteName={siteName} />, 404);
    const origin = requestOrigin(c, config);
    const label = categoryLabel(category);
    const bots = repo.list({ category, limit: 100 });
    const total = repo.count({ category });
    return sendPage(
      c,
      <Layout
        title={`${label} bots`}
        description={`${label} bots for Grok Bot on ${siteName}.`}
        siteName={siteName}
        ogUrl={`${origin}/c/${category}`}
        ogImage={defaultOgImage(origin)}
        current="browse"
      >
        <section class="page-head">
          <h1>{label}</h1>
          <p class="lede">{plural(total, 'bot')}</p>
        </section>
        <CategoryChips counts={repo.categoryCounts()} active={category} />
        <section class="shelf">
          {bots.length > 0 ? (
            <BotGrid bots={bots} />
          ) : (
            <EmptyState title={`No ${label} bots yet`}>
              <p>Built one that fits? Publish it here.</p>
              <p>
                <a class="btn btn-primary" href="/submit">
                  Submit a bot
                </a>
              </p>
            </EmptyState>
          )}
          {total > bots.length ? <p class="more">Showing the newest {bots.length} of {total}.</p> : null}
        </section>
      </Layout>,
    );
  });

  app.get('/search', (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 200);
    const bots = q ? repo.list({ q, limit: 100 }) : [];
    const total = q ? repo.count({ q }) : 0;
    return sendPage(
      c,
      <Layout title={q ? `Search: ${q}` : 'Search'} siteName={siteName} current="browse">
        <section class="page-head">
          <h1>Search</h1>
          <SearchForm q={q} />
          {q && total > 0 ? (
            <p class="lede" role="status">
              {total === 1 ? '1 bot matches' : `${total} bots match`} “{q}”
            </p>
          ) : null}
        </section>
        {!q ? (
          <>
            <p class="lede">Search by name, tagline or tag, or browse a category.</p>
            <CategoryChips counts={repo.categoryCounts()} />
          </>
        ) : bots.length > 0 ? (
          <section class="shelf">
            <BotGrid bots={bots} />
          </section>
        ) : (
          <EmptyState title={`No bots match “${q}”`}>
            <p>Try a shorter word, or browse by category.</p>
            <CategoryChips counts={repo.categoryCounts()} />
          </EmptyState>
        )}
      </Layout>,
    );
  });

  return app;
}
