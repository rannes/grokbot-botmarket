import type { Child } from 'hono/jsx';
import { CATEGORIES, categoryLabel, type Category } from '../core/categories.js';
import { buildRecipeInstallPrompt } from '../core/install-prompt.js';
import type { Recipe } from '../core/recipe.js';
import { templateDeepLink, templatePageUrl, templateUniversalLink } from '../core/template-link.js';
import type { Bot } from '../db/bots-repo.js';
import { recipeJsonUrl } from '../routes/shared.js';

/** Grok Bot avatar color names → fills for light and dark color schemes. */
export const AVATAR_COLORS = {
  magenta: { light: '#D6338A', dark: '#F06BB4' },
  blue: { light: '#2F6FEB', dark: '#6EA2FF' },
  green: { light: '#1F9D57', dark: '#4CD08A' },
  orange: { light: '#EE7A1C', dark: '#FFA155' },
  purple: { light: '#8048E0', dark: '#AE88FF' },
  teal: { light: '#13A3A0', dark: '#3FD4CF' },
  red: { light: '#E0403A', dark: '#FF7A72' },
  yellow: { light: '#F2BC1B', dark: '#FFD54D' },
  pink: { light: '#F27BB0', dark: '#FFA6CC' },
  gray: { light: '#8A88A0', dark: '#A9A7BF' },
} as const;
export type AvatarColor = keyof typeof AVATAR_COLORS;
const COLOR_NAMES = Object.keys(AVATAR_COLORS) as AvatarColor[];
const SHAPES = new Set(['pebble', 'capsule', 'teardrop', 'circle']);

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarColor(color: string | null | undefined, name: string): AvatarColor {
  const c = color?.trim().toLowerCase() ?? '';
  if ((COLOR_NAMES as string[]).includes(c)) return c as AvatarColor;
  return COLOR_NAMES[hash(name) % COLOR_NAMES.length] as AvatarColor;
}

export function avatarShape(shape: string | null | undefined): string {
  const s = shape?.trim().toLowerCase() ?? '';
  return SHAPES.has(s) ? s : 'circle';
}

/** CSS for the avatar color classes, appended to styles.css at startup (single source of truth). */
export function avatarColorCss(): string {
  const light = COLOR_NAMES.map((n) => `.av-${n}{--av:${AVATAR_COLORS[n].light}}`).join('\n');
  const dark = COLOR_NAMES.map((n) => `  .av-${n}{--av:${AVATAR_COLORS[n].dark}}`).join('\n');
  return `/* avatar colors (generated from AVATAR_COLORS) */\n${light}\n@media (prefers-color-scheme: dark){\n${dark}\n}\n`;
}

export const botPath = (slug: string) => `/bots/${encodeURIComponent(slug)}`;
export const addPath = (slug: string) => `/add/${encodeURIComponent(slug)}`;
export const recipePath = (slug: string) => `/api/bots/${encodeURIComponent(slug)}/recipe.json`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export function BotAvatar({
  shape,
  color,
  name,
  size = 'md',
  sleepy = false,
}: {
  shape: string | null | undefined;
  color: string | null | undefined;
  name: string;
  size?: AvatarSize;
  sleepy?: boolean;
}) {
  const cls = `av av-${avatarShape(shape)} av-${avatarColor(color, name)} av-${size}${sleepy ? ' av-sleepy' : ''}`;
  return <span class={cls} aria-hidden="true"></span>;
}

export function BotCard({ bot, featured = false }: { bot: Bot; featured?: boolean }) {
  const cls = featured ? `card is-featured av-${avatarColor(bot.avatarColor, bot.name)}` : 'card';
  return (
    <li class={cls}>
      <BotAvatar shape={bot.avatarShape} color={bot.avatarColor} name={bot.name} size={featured ? 'lg' : 'md'} />
      <div class="card-text">
        <h3>
          <a href={botPath(bot.slug)}>{bot.name}</a>
        </h3>
        <p class="tagline">{bot.tagline}</p>
      </div>
      <div class="card-foot">
        <p class="card-meta">
          <span>by {bot.authorName}</span>
          <span>{categoryLabel(bot.category)}</span>
        </p>
        <a class="btn btn-sm btn-add" href={addPath(bot.slug)} aria-label={`Add ${bot.name} to Grok Bot`}>
          Add
        </a>
      </div>
    </li>
  );
}

export function BotGrid({ bots, featured = false }: { bots: Bot[]; featured?: boolean }) {
  return (
    <ul class={featured ? 'grid grid-featured' : 'grid'}>
      {bots.map((b) => (
        <BotCard bot={b} featured={featured} />
      ))}
    </ul>
  );
}

export function CopyButton({
  value,
  label = 'Copy',
  what,
  small = true,
}: {
  value: string;
  label?: string;
  what?: string;
  small?: boolean;
}) {
  return (
    <button type="button" class={small ? 'btn btn-sm' : 'btn'} data-copy={value} aria-label={what ? `${label} ${what}` : undefined} aria-live="polite">
      {label}
    </button>
  );
}

export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div class="copyfield">
      <p class="copyfield-label">{label}</p>
      <div class="copyfield-row">
        <code>{value}</code>
        <CopyButton value={value} what={label.toLowerCase()} />
      </div>
    </div>
  );
}

const INSTALL_NOTE = 'Requires the Grok Bot app. Nothing is added until you confirm inside Grok Bot.';

export function InstallButtons({ bot, origin }: { bot: Bot; origin: string }) {
  if (bot.templateId) {
    const id = bot.templateId;
    return (
      <div class="install">
        <div class="install-actions">
          <a href={addPath(bot.slug)} class="btn btn-primary">
            Add to Grok Bot
          </a>
          <a href={templatePageUrl(id)} class="btn" rel="noopener" target="_blank">
            Open on x.ai
          </a>
        </div>
        <p class="install-note">{INSTALL_NOTE}</p>
        <details class="other-ways">
          <summary>Other ways to add</summary>
          <CopyField label="App link" value={templateDeepLink(id)} />
          <CopyField label="Web link, opens the app when it’s installed" value={templateUniversalLink(id)} />
          {bot.recipe ? (
            <p>
              <a href={recipePath(bot.slug)} download>
                Download recipe
              </a>
            </p>
          ) : null}
        </details>
      </div>
    );
  }
  let prompt: string | null = null;
  try {
    prompt = buildRecipeInstallPrompt({ recipeUrl: recipeJsonUrl(origin, bot.slug), name: bot.name });
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
  }
  return (
    <div class="install">
      <div class="install-actions">
        <a href={addPath(bot.slug)} class="btn btn-primary">
          Create in Grok Bot
        </a>
        {prompt ? <CopyButton value={prompt} label="Copy setup prompt" small={false} /> : null}
        <a href={recipePath(bot.slug)} class="btn" download>
          Download recipe
        </a>
      </div>
      <p class="install-note">{INSTALL_NOTE}</p>
      <p class="install-note">
        This starts a new bot that reads the recipe, shows you what’s in it, and sets itself up once you say yes.
      </p>
      {prompt ? null : (
        <p class="install-note">
          The setup prompt is too long to copy from this server’s address. Download the recipe and give it to a new bot
          instead.
        </p>
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span class="count">{n}</span>;
}

export function RecipeSections({ recipe }: { recipe: Recipe }) {
  const { memory, skills, routines, plugins } = recipe;
  return (
    <section class="recipe" aria-labelledby="recipe-h">
      <h2 id="recipe-h">What’s inside</h2>
      <p class="lede">The new bot writes these itself after you confirm. Routines start paused.</p>
      {recipe.setupNotes ? (
        <div class="setup-notes">
          <h3>Before you start</h3>
          <p>{recipe.setupNotes}</p>
        </div>
      ) : null}
      {memory.length > 0 ? (
        <div class="recipe-part">
          <h3>
            Memories <Count n={memory.length} />
          </h3>
          <ul class="memories">
            {memory.map((m) => (
              <li>{m.content}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {skills.length > 0 ? (
        <div class="recipe-part">
          <h3>
            Skills <Count n={skills.length} />
          </h3>
          {skills.map((s) => (
            <details class="skill">
              <summary>
                <span class="skill-name">{s.name}</span>
                {recipe.gettingStarted?.skill === s.name ? <span class="pill">Runs first</span> : null}
                {s.description ? <span class="skill-desc">{s.description}</span> : null}
              </summary>
              <pre>{s.content}</pre>
            </details>
          ))}
        </div>
      ) : null}
      {routines.length > 0 ? (
        <div class="recipe-part">
          <h3>
            Routines <Count n={routines.length} />
          </h3>
          <ul class="routines">
            {routines.map((r) => (
              <li>
                <p class="routine-name">{r.name}</p>
                {r.description ? <p>{r.description}</p> : null}
                {r.schedule || r.timezone ? (
                  <p class="routine-when">
                    {r.schedule ? <code>{r.schedule}</code> : null}
                    {r.timezone ? <span>{r.timezone}</span> : null}
                  </p>
                ) : null}
                <details class="routine-prompt">
                  <summary>Prompt</summary>
                  <pre>{r.content}</pre>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plugins.length > 0 ? (
        <div class="recipe-part">
          <h3>
            Plugins <Count n={plugins.length} />
          </h3>
          <p class="hint">The bot asks before installing any of these.</p>
          <ul class="plugins">
            {plugins.map((p) => (
              <li>
                <span class="plugin-name">{p.name}</span>
                {p.description ? <span class="plugin-desc">{p.description}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {memory.length + skills.length + routines.length + plugins.length === 0 ? (
        <p>This recipe only sets the bot’s name and description.</p>
      ) : null}
    </section>
  );
}

export function CategoryChips({
  counts,
  active,
}: {
  counts: Record<Category, number>;
  active?: Category | 'all';
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0 && (active === undefined || active === 'all')) return null;
  return (
    <nav class="chips-nav" aria-label="Categories">
      <ul class="chips">
        <li>
          <a class="chip" href="/" aria-current={active === 'all' ? 'page' : undefined}>
            All <span class="n">{total}</span>
          </a>
        </li>
        {CATEGORIES.filter((c) => counts[c.id] > 0 || active === c.id).map((c) => (
          <li>
            <a class="chip" href={`/c/${c.id}`} aria-current={active === c.id ? 'page' : undefined}>
              {c.label} <span class="n">{counts[c.id]}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function EmptyState({ title, children }: { title: string; children?: Child }) {
  return (
    <div class="empty">
      <BotAvatar shape="pebble" color="gray" name="empty" size="lg" sleepy />
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export { plural };
