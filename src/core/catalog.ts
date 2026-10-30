import { z } from 'zod';
import type { Bot, NewBot } from '../db/bots-repo.js';
import { isCategory, type Category } from './categories.js';
import { parseRecipe, type Recipe } from './recipe.js';
import { TEMPLATE_ID_RE, templateDeepLink, templatePageUrl } from './template-link.js';

export const CATALOG_FORMAT = 'botmarket-catalog/v1';
const MAX_BOTS = 5000;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface CatalogBot {
  slug: string;
  name: string;
  tagline: string;
  descriptionMd: string;
  category: Category;
  tags: string[];
  authorName: string;
  authorUrl: string | null;
  avatarShape: string | null;
  avatarColor: string | null;
  imageUrl: string | null;
  templateId: string | null;
  recipe: Recipe | null;
  sourceUrl: string | null;
  homepageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  installUrl: string | null;
  pageUrl: string | null;
}

export interface Catalog {
  format: typeof CATALOG_FORMAT;
  generatedAt: string;
  site: { name: string; url: string | null };
  bots: CatalogBot[];
}

export function toCatalogBot(bot: Bot): CatalogBot {
  return {
    slug: bot.slug,
    name: bot.name,
    tagline: bot.tagline,
    descriptionMd: bot.descriptionMd,
    category: bot.category,
    tags: [...bot.tags],
    authorName: bot.authorName,
    authorUrl: bot.authorUrl,
    avatarShape: bot.avatarShape,
    avatarColor: bot.avatarColor,
    imageUrl: bot.imageUrl,
    templateId: bot.templateId,
    recipe: bot.recipe,
    sourceUrl: bot.sourceUrl,
    homepageUrl: bot.homepageUrl,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    installUrl: bot.templateId ? templateDeepLink(bot.templateId) : null,
    pageUrl: bot.templateId ? templatePageUrl(bot.templateId) : null,
  };
}

export function exportCatalog(
  bots: Bot[],
  site: { name: string; url: string | null },
  now: () => Date = () => new Date(),
): Catalog {
  return {
    format: CATALOG_FORMAT,
    generatedAt: now().toISOString(),
    site: { name: site.name, url: site.url },
    bots: bots.map(toCatalogBot),
  };
}

const httpsUrl = z
  .string()
  .max(2048)
  .refine((s) => URL.canParse(s) && new URL(s).protocol === 'https:', 'must be an https URL');
const optUrl = httpsUrl.nullish().transform((v) => v ?? null);
const optShort = z.string().max(32).nullish().transform((v) => v ?? null);

const BotSchema = z.object({
  slug: z.string().regex(SLUG_RE, 'must be lowercase letters, digits and hyphens (1-64 chars)'),
  name: z.string().min(1).max(80),
  tagline: z.string().min(1).max(200),
  descriptionMd: z.string().max(20000).default(''),
  category: z.custom<Category>(isCategory, 'unknown category'),
  tags: z.array(z.string().min(1).max(32)).max(10).default([]),
  authorName: z.string().min(1).max(80),
  authorUrl: optUrl,
  avatarShape: optShort,
  avatarColor: optShort,
  imageUrl: optUrl,
  templateId: z.string().regex(TEMPLATE_ID_RE, 'invalid template id').nullish().transform((v) => v ?? null),
  recipe: z.unknown().optional(),
  sourceUrl: optUrl,
  homepageUrl: optUrl,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const CatalogSchema = z.object({
  format: z.literal(CATALOG_FORMAT, { errorMap: () => ({ message: `must be "${CATALOG_FORMAT}"` }) }),
  generatedAt: z.string(),
  site: z.object({ name: z.string().min(1).max(80), url: httpsUrl.nullish().transform((v) => v ?? null) }),
  bots: z.array(z.unknown()).max(MAX_BOTS, `must have at most ${MAX_BOTS} bots`),
});

function fmtPath(path: (string | number)[], prefix: (string | number)[] = []): string {
  let out = '';
  for (const seg of [...prefix, ...path]) {
    out += typeof seg === 'number' ? `[${seg}]` : out ? `.${seg}` : seg;
  }
  return out;
}

function fmtIssues(issues: z.ZodIssue[], prefix: (string | number)[] = []): string[] {
  return issues.map((i) => {
    const p = fmtPath(i.path, prefix);
    return p ? `${p}: ${i.message}` : i.message;
  });
}

export function parseCatalog(input: unknown): { ok: true; catalog: Catalog } | { ok: false; errors: string[] } {
  const head = CatalogSchema.safeParse(input);
  if (!head.success) return { ok: false, errors: fmtIssues(head.error.issues) };
  const { generatedAt, site } = head.data;

  const errors: string[] = [];
  const bots: CatalogBot[] = [];
  const seen = new Map<string, number>();
  head.data.bots.forEach((raw, i) => {
    const r = BotSchema.safeParse(raw);
    if (!r.success) {
      errors.push(...fmtIssues(r.error.issues, ['bots', i]));
      return;
    }
    const d = r.data;
    const first = seen.get(d.slug);
    if (first !== undefined) {
      errors.push(`bots[${i}].slug: duplicate of bots[${first}]`);
      return;
    }
    seen.set(d.slug, i);
    let recipe: Recipe | null = null;
    if (d.recipe !== undefined && d.recipe !== null) {
      const pr = parseRecipe(d.recipe);
      if (!pr.ok) {
        errors.push(...pr.errors.map((e) => `bots[${i}].recipe: ${e}`));
        return;
      }
      recipe = pr.recipe;
    }
    if (d.templateId === null && recipe === null) {
      errors.push(`bots[${i}]: needs templateId or recipe`);
      return;
    }
    bots.push({
      slug: d.slug,
      name: d.name,
      tagline: d.tagline,
      descriptionMd: d.descriptionMd,
      category: d.category,
      tags: d.tags,
      authorName: d.authorName,
      authorUrl: d.authorUrl,
      avatarShape: d.avatarShape,
      avatarColor: d.avatarColor,
      imageUrl: d.imageUrl,
      templateId: d.templateId,
      recipe,
      sourceUrl: d.sourceUrl,
      homepageUrl: d.homepageUrl,
      createdAt: d.createdAt ?? generatedAt,
      updatedAt: d.updatedAt ?? d.createdAt ?? generatedAt,
      installUrl: d.templateId ? templateDeepLink(d.templateId) : null,
      pageUrl: d.templateId ? templatePageUrl(d.templateId) : null,
    });
  });
  if (errors.length > 100) {
    const extra = errors.length - 100;
    errors.length = 100;
    errors.push(`... and ${extra} more`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, catalog: { format: CATALOG_FORMAT, generatedAt, site, bots } };
}

export function catalogBotToNewBot(cb: CatalogBot): NewBot & { slug: string } {
  return {
    slug: cb.slug,
    name: cb.name,
    tagline: cb.tagline,
    descriptionMd: cb.descriptionMd,
    category: cb.category,
    tags: [...cb.tags],
    authorName: cb.authorName,
    authorUrl: cb.authorUrl,
    avatarShape: cb.avatarShape,
    avatarColor: cb.avatarColor,
    imageUrl: cb.imageUrl,
    templateId: cb.templateId,
    recipe: cb.recipe,
    sourceUrl: cb.sourceUrl,
    homepageUrl: cb.homepageUrl,
  };
}
