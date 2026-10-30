import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import { CATEGORIES } from '../core/categories.js';
import { parseRecipeText } from '../core/recipe.js';
import { slugify } from '../core/slug.js';
import { parseTemplateRef } from '../core/template-link.js';
import { botFromInput } from '../core/validation.js';
import { resolveDeps, type AppDeps } from '../deps.js';
import { BotAvatar, botPath } from '../views/components.js';
import { Layout, MessagePage, sendPage } from '../views/layout.js';
import { clientIp } from './shared.js';

const FIELDS = [
  'ref',
  'recipeText',
  'name',
  'tagline',
  'category',
  'tags',
  'authorName',
  'authorUrl',
  'descriptionMd',
  'imageUrl',
  'sourceUrl',
  'homepageUrl',
  'avatarShape',
  'avatarColor',
] as const;
type Field = (typeof FIELDS)[number];
type Values = Partial<Record<Field, string>>;

/** Labels used in the form and to turn "field: message" errors into readable ones. */
const LABELS: Record<string, string> = {
  ref: 'Template link',
  templateRef: 'Template link',
  recipe: 'Recipe',
  recipeText: 'Recipe',
  name: 'Name',
  tagline: 'Tagline',
  category: 'Category',
  tags: 'Tags',
  authorName: 'Your name',
  authorUrl: 'Your link',
  descriptionMd: 'Description',
  imageUrl: 'Image URL',
  sourceUrl: 'Source URL',
  homepageUrl: 'Homepage URL',
  avatarShape: 'Avatar shape',
  avatarColor: 'Avatar color',
};

// Recipes may be up to 2 MB of JSON; leave room for the other fields and form encoding.
const MAX_FORM_BYTES = 6 * 1024 * 1024;
const TAGLINE_MAX = 200;

function readValues(body: Record<string, unknown>): Values {
  const out: Values = {};
  for (const f of FIELDS) {
    const v = body[f];
    if (typeof v === 'string') out[f] = v;
  }
  return out;
}

function errorField(message: string): string | null {
  const m = /^([A-Za-z]+): /.exec(message);
  return m?.[1] ?? null;
}

function friendlyError(message: string): string {
  const key = errorField(message);
  const label = key ? LABELS[key] : undefined;
  return label && key ? `${label}: ${message.slice(key.length + 2)}` : message;
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

interface FormProps {
  siteName: string;
  requireApproval: boolean;
  values: Values;
  errors?: string[];
  warning?: string;
  notice?: string;
}

function Field({
  id,
  label,
  hint,
  invalid,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  invalid?: boolean;
  children?: unknown;
}) {
  return (
    <div class={invalid ? 'field is-invalid' : 'field'}>
      <label for={id}>{label}</label>
      {children}
      {hint ? (
        <p class="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SubmitPage({ siteName, requireApproval, values: v, errors = [], warning, notice }: FormProps) {
  const bad = new Set(errors.map(errorField).filter((k): k is string => k !== null));
  if (bad.has('templateRef')) bad.add('ref');
  if (bad.has('recipe')) bad.add('recipeText');
  const inv = (f: Field) => (bad.has(f) ? 'true' : undefined);
  const input = (f: Field, extra: Record<string, unknown> = {}) => (
    <input id={`f-${f}`} name={f} value={v[f] ?? ''} aria-invalid={inv(f)} aria-describedby={`f-${f}-hint`} {...extra} />
  );
  return (
    <Layout
      title="Submit a bot"
      description={`Publish a Grok Bot bot on ${siteName} so anyone can add it in one click.`}
      siteName={siteName}
      current="submit"
    >
      <section class="page-head">
        <h1>Submit a bot</h1>
        <p class="lede">Share a bot you built. People add it to their own Grok Bot in one click.</p>
      </section>
      {errors.length > 0 ? (
        <div class="alert alert-error" role="alert">
          <p class="alert-title">Fix these before publishing:</p>
          <ul>
            {errors.map((e) => (
              <li>{friendlyError(e)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warning ? (
        <div class="alert alert-warn" role="status">
          <p>{warning}</p>
        </div>
      ) : null}
      {notice ? (
        <div class="alert alert-ok" role="status">
          <p>{notice}</p>
        </div>
      ) : null}
      <form class="submit-form" method="post" action="/submit">
        {/* First submit button in tree order is the implicit (Enter key) action: publish, not look up. */}
        <button type="submit" class="sr-only" tabindex={-1} aria-hidden="true">
          {requireApproval ? 'Send for review' : 'Publish bot'}
        </button>
        <fieldset class="step">
          <legend>
            <span class="step-n">1</span>
            <span>Point to the bot</span>
          </legend>
          <p class="step-intro">Use the bot’s official template link, or paste an open recipe.</p>
          <Field
            id="f-ref"
            label="Template link"
            hint="The share link from Grok Bot or x.ai/bot/…, or the 21-character template id. Look up fills in the name and description."
            invalid={bad.has('ref')}
          >
            <div class="inline-row">
              {input('ref', { type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: false, placeholder: 'https://x.ai/bot/…' })}
              <button class="btn" type="submit" name="lookup" value="template" formaction="/submit/lookup" formnovalidate>
                Look up
              </button>
            </div>
          </Field>
          <details class="recipe-field" open={v.recipeText?.trim() ? true : undefined}>
            <summary>Or paste a recipe</summary>
            <Field
              id="f-recipeText"
              label="Recipe JSON"
              hint="A grokbot-recipe/v1 file: the JSON Grok Bot writes when you ask a bot to export itself. Its contents are public on the bot page."
              invalid={bad.has('recipeText')}
            >
              <textarea
                id="f-recipeText"
                name="recipeText"
                class="mono"
                rows={10}
                spellcheck={false}
                aria-invalid={inv('recipeText')}
                aria-describedby="f-recipeText-hint"
              >
                {v.recipeText ?? ''}
              </textarea>
              <div>
                <button class="btn btn-sm" type="submit" name="lookup" value="recipe" formaction="/submit/lookup" formnovalidate>
                  Fill in from recipe
                </button>
              </div>
            </Field>
          </details>
        </fieldset>

        <fieldset class="step">
          <legend>
            <span class="step-n">2</span>
            <span>Describe it</span>
          </legend>
          <Field id="f-name" label="Name" invalid={bad.has('name')} hint="Up to 80 characters.">
            {input('name', { type: 'text', required: true, maxlength: 80 })}
          </Field>
          <Field id="f-tagline" label="Tagline" invalid={bad.has('tagline')} hint="One sentence on what it does. Up to 200 characters.">
            {input('tagline', { type: 'text', required: true, maxlength: TAGLINE_MAX })}
          </Field>
          <Field id="f-category" label="Category" invalid={bad.has('category')}>
            <select id="f-category" name="category" required aria-invalid={inv('category')}>
              <option value="">Choose a category</option>
              {CATEGORIES.map((c) => (
                <option value={c.id} selected={v.category === c.id ? true : undefined}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="f-tags" label="Tags" invalid={bad.has('tags')} hint="Comma-separated, up to 10. For example: github, release notes">
            {input('tags', { type: 'text', autocomplete: 'off' })}
          </Field>
          <Field
            id="f-descriptionMd"
            label="Description"
            invalid={bad.has('descriptionMd')}
            hint="Markdown. Say what the bot does, what it needs access to, and how to get started."
          >
            <textarea
              id="f-descriptionMd"
              name="descriptionMd"
              rows={10}
              aria-invalid={inv('descriptionMd')}
              aria-describedby="f-descriptionMd-hint"
            >
              {v.descriptionMd ?? ''}
            </textarea>
          </Field>
          <Field id="f-imageUrl" label="Image URL" invalid={bad.has('imageUrl')} hint="Optional. An https:// image shown on the bot page and in link previews.">
            {input('imageUrl', { type: 'url', inputmode: 'url', placeholder: 'https://' })}
          </Field>
          {v.avatarShape || v.avatarColor ? (
            <p class="avatar-preview">
              <BotAvatar shape={v.avatarShape} color={v.avatarColor} name={v.name ?? ''} size="sm" />
              <span>Uses the bot’s avatar from Grok Bot.</span>
            </p>
          ) : null}
          <input type="hidden" name="avatarShape" value={v.avatarShape ?? ''} />
          <input type="hidden" name="avatarColor" value={v.avatarColor ?? ''} />
        </fieldset>

        <fieldset class="step">
          <legend>
            <span class="step-n">3</span>
            <span>Credit and links</span>
          </legend>
          <Field id="f-authorName" label="Your name" invalid={bad.has('authorName')} hint="Shown as the author.">
            {input('authorName', { type: 'text', required: true, maxlength: 80, autocomplete: 'name' })}
          </Field>
          <Field id="f-authorUrl" label="Your link" invalid={bad.has('authorUrl')} hint="Optional. A profile or website, https:// only.">
            {input('authorUrl', { type: 'url', inputmode: 'url', placeholder: 'https://' })}
          </Field>
          <Field id="f-sourceUrl" label="Source URL" invalid={bad.has('sourceUrl')} hint="Optional. Where the bot’s files or docs live.">
            {input('sourceUrl', { type: 'url', inputmode: 'url', placeholder: 'https://' })}
          </Field>
          <Field id="f-homepageUrl" label="Homepage URL" invalid={bad.has('homepageUrl')} hint="Optional.">
            {input('homepageUrl', { type: 'url', inputmode: 'url', placeholder: 'https://' })}
          </Field>
        </fieldset>

        <div class="submit-row">
          <button class="btn btn-primary btn-big" type="submit">
            {requireApproval ? 'Send for review' : 'Publish bot'}
          </button>
          <p class="hint">
            {requireApproval
              ? 'An admin reviews new bots before they appear in the catalog.'
              : 'Your bot appears in the catalog right away.'}
          </p>
        </div>
      </form>
    </Layout>
  );
}

export function submitRoutes(deps: AppDeps): Hono {
  const d = resolveDeps(deps);
  const { repo, config } = d;
  const siteName = config.siteName;
  const app = new Hono();
  const limit = bodyLimit({
    maxSize: MAX_FORM_BYTES,
    onError: (c) => sendPage(c, <MessagePage siteName={siteName} title="That’s too big"><p class="lede">The form was larger than 6 MB. Recipes can be at most 2 MB.</p></MessagePage>, 413),
  });

  const form = (c: Context, props: Omit<FormProps, 'siteName' | 'requireApproval'>, status: 200 | 400 = 200) =>
    sendPage(c, <SubmitPage siteName={siteName} requireApproval={config.requireApproval} {...props} />, status);

  app.get('/submit', (c) => form(c, { values: {} }));

  app.post('/submit/lookup', limit, async (c) => {
    const values = readValues(await c.req.parseBody());
    const ref = values.ref?.trim() ?? '';
    const recipeText = values.recipeText?.trim() ?? '';

    if (ref === '' && recipeText !== '') {
      const parsed = parseRecipeText(recipeText);
      if (!parsed.ok) {
        const errors = parsed.errors.map((e) => (e.startsWith('recipe:') ? e : `recipe: ${e}`));
        return form(c, { values, errors }, 400);
      }
      const { profile } = parsed.recipe;
      return form(c, {
        values: {
          ...values,
          name: profile.name.slice(0, 80),
          tagline: profile.description ? truncate(profile.description, TAGLINE_MAX) : values.tagline,
          descriptionMd: values.descriptionMd?.trim() ? values.descriptionMd : profile.description,
          avatarShape: profile.avatarShape ?? values.avatarShape,
          avatarColor: profile.avatarColor ?? values.avatarColor,
        },
        notice: 'Filled in from the recipe. Check the details, then publish.',
      });
    }

    const id = parseTemplateRef(ref);
    if (!id) {
      const errors = [ref === '' ? 'Provide a template link or a recipe' : 'templateRef: not a Grok Bot template link or id'];
      return form(c, { values, errors }, 400);
    }
    const meta = await d.fetchMetadata(id).catch(() => null);
    if (!meta) {
      return form(c, { values, warning: 'Couldn’t fetch details from x.ai. Fill them in by hand.' });
    }
    return form(c, {
      values: {
        ...values,
        name: meta.name.slice(0, 80),
        tagline: meta.description ? truncate(meta.description, TAGLINE_MAX) : values.tagline,
        descriptionMd: values.descriptionMd?.trim() ? values.descriptionMd : meta.description,
        avatarShape: meta.avatarShape ?? values.avatarShape,
        avatarColor: meta.avatarColor ?? values.avatarColor,
        imageUrl: meta.imageUrl ?? values.imageUrl,
      },
      notice: 'Filled in from x.ai. Check the details, then publish.',
    });
  });

  app.post('/submit', limit, async (c) => {
    if (!d.submitLimiter.allow(clientIp(c), d.now().getTime())) {
      return sendPage(
        c,
        <MessagePage siteName={siteName} title="Too many submissions">
          <p class="lede">You’ve sent a lot of bots in the last hour. Try again later.</p>
        </MessagePage>,
        429,
      );
    }
    const values = readValues(await c.req.parseBody());
    const { ref, ...rest } = values;
    const result = botFromInput({ ...rest, templateRef: ref });
    if (!result.ok) return form(c, { values, errors: result.errors }, 400);
    const status = config.requireApproval ? 'pending' : 'published';
    const bot = repo.insert({ ...result.bot, slug: slugify(result.bot.name), status });
    return c.redirect(status === 'published' ? botPath(bot.slug) : '/submitted', 303);
  });

  app.get('/submitted', (c) =>
    sendPage(
      c,
      <MessagePage siteName={siteName} title="Thanks, your bot is in the queue">
        <p class="lede">It’s waiting for approval. Once an admin approves it, it shows up in the catalog.</p>
        <p>
          <a class="btn btn-primary" href="/">
            Browse bots
          </a>
        </p>
      </MessagePage>,
    ),
  );

  return app;
}
