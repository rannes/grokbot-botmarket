import { categoryLabel } from '../core/categories.js';
import { renderMarkdown } from '../core/markdown.js';
import type { Bot } from '../db/bots-repo.js';
import { BotAvatar, CopyButton, InstallButtons, RecipeSections, addPath, botPath } from './components.js';

function Stat({ n, one, many }: { n: number; one: string; many?: string }) {
  return (
    <p class="stat">
      <span class="stat-n">{n}</span> {n === 1 ? one : (many ?? `${one}s`)}
    </p>
  );
}

/** Full bot page body; shared by the public /bots/:slug page and the admin preview. */
export function BotDetail({ bot, origin }: { bot: Bot; origin: string }) {
  const shareUrl = `${origin}${botPath(bot.slug)}`;
  const badge = `[![Add to Grok Bot](${origin}/badge/${encodeURIComponent(bot.slug)}.svg)](${origin}${addPath(bot.slug)})`;
  const links = [
    bot.homepageUrl ? { href: bot.homepageUrl, label: 'Homepage' } : null,
    bot.sourceUrl ? { href: bot.sourceUrl, label: 'Source' } : null,
  ].filter((l): l is { href: string; label: string } => l !== null);
  return (
    <article class="bot">
      <header class="bot-head">
        <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} name={bot.name} size="xl" />
        <div class="bot-intro">
          <h1>{bot.name}</h1>
          <p class="bot-tagline">{bot.tagline}</p>
          <p class="byline">
            <span>
              by{' '}
              {bot.authorUrl ? (
                <a href={bot.authorUrl} rel="noopener nofollow ugc" target="_blank">
                  {bot.authorName}
                </a>
              ) : (
                bot.authorName
              )}
            </span>
            <a class="byline-cat" href={`/c/${bot.category}`}>
              {categoryLabel(bot.category)}
            </a>
          </p>
          {bot.tags.length > 0 ? (
            <ul class="tags" aria-label="Tags">
              {bot.tags.map((t) => (
                <li>
                  <a class="tag" href={`/search?q=${encodeURIComponent(t)}`}>
                    {t}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <InstallButtons bot={bot} origin={origin} />
        </div>
      </header>
      <div class="bot-body">
        <div class="bot-main">
          {bot.imageUrl ? (
            <figure class="bot-image">
              <img src={bot.imageUrl} alt={`Preview of ${bot.name}`} loading="lazy" referrerpolicy="no-referrer" />
            </figure>
          ) : null}
          {bot.descriptionMd.trim() ? (
            <div class="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(bot.descriptionMd) }} />
          ) : null}
          {bot.recipe ? <RecipeSections recipe={bot.recipe} /> : null}
        </div>
        <aside class="bot-side">
          <div class="side-block stats">
            <Stat n={bot.installClicks} one="add" />
            <Stat n={bot.upvotes} one="upvote" />
          </div>
          <div class="side-block">
            <h2>Share</h2>
            <div class="copyfield-row">
              <code>{shareUrl}</code>
              <CopyButton value={shareUrl} label="Copy link" />
            </div>
            <p class="hint">README badge</p>
            <img class="badge" src={`/badge/${encodeURIComponent(bot.slug)}.svg`} alt="Add to Grok Bot" />
            <div class="copyfield-row">
              <code>{badge}</code>
              <CopyButton value={badge} label="Copy" what="badge Markdown" />
            </div>
          </div>
          {links.length > 0 ? (
            <div class="side-block">
              <h2>Links</h2>
              <ul class="links">
                {links.map((l) => (
                  <li>
                    <a href={l.href} rel="noopener nofollow ugc" target="_blank">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
