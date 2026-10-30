import { z } from 'zod';
import type { NewBot } from '../db/bots-repo.js';
import { isCategory, CATEGORIES } from './categories.js';
import { MAX_RECIPE_BYTES, parseRecipe, parseRecipeText, type Recipe } from './recipe.js';
import { parseTemplateRef } from './template-link.js';

const blankToNull = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
};

const text = (min: number, max: number) =>
  z
    .string({ required_error: 'is required', invalid_type_error: 'must be text' })
    .trim()
    .min(min, min === 1 ? 'is required' : `must be at least ${min} characters`)
    .max(max, `must be at most ${max} characters`);

const optShort = z.preprocess(blankToNull, z.string().max(32, 'must be at most 32 characters').nullable());

/** True for absolute https:// URLs without credentials. */
export function isHttpsUrl(s: string): boolean {
  if (!URL.canParse(s)) return false;
  const u = new URL(s);
  return u.protocol === 'https:' && u.hostname !== '' && !u.username && !u.password;
}

const optUrl = z.preprocess(
  blankToNull,
  z.string().max(2048, 'must be at most 2048 characters').refine(isHttpsUrl, 'must be an https:// URL').nullable(),
);

const tags = z.preprocess(
  (v) => (v === undefined || v === null ? [] : typeof v === 'string' ? v.split(',') : v),
  z
    .array(z.string({ invalid_type_error: 'must be text' }))
    .transform((list) => [...new Set(list.map((t) => t.trim().toLowerCase()).filter((t) => t !== ''))])
    .pipe(z.array(z.string().max(32, 'each tag must be at most 32 characters')).max(10, 'at most 10 tags')),
);

const optString = z.preprocess(
  (v) => (v === undefined || v === null ? undefined : v),
  z.string({ invalid_type_error: 'must be text' }).optional(),
);

/** Issues flagged raw are shown without a "field:" prefix. */
const raw = (ctx: z.RefinementCtx, message: string) =>
  ctx.addIssue({ code: z.ZodIssueCode.custom, message, params: { raw: true } });

/** Template link or bare id → templateId (null when blank). */
const templateRef = optString.transform((v, ctx): string | null => {
  const ref = v?.trim() ?? '';
  if (ref === '') return null;
  const id = parseTemplateRef(ref);
  if (!id) raw(ctx, 'templateRef: not a Grok Bot template link or id');
  return id;
});

function recipeOrIssues(parsed: ReturnType<typeof parseRecipe>, ctx: z.RefinementCtx): Recipe | null {
  if (parsed.ok) return parsed.recipe;
  for (const e of parsed.errors) raw(ctx, e.startsWith('recipe:') ? e : `recipe: ${e}`);
  return null;
}

/** Pasted recipe JSON → Recipe (undefined when blank). */
const recipeText = optString.transform((v, ctx): Recipe | null | undefined => {
  const t = v?.trim() ?? '';
  return t === '' ? undefined : recipeOrIssues(parseRecipeText(t), ctx);
});

/** JSON API convenience: a recipe object instead of recipeText. Same 2 MB cap as pasted text. */
const recipeObject = z
  .unknown()
  .optional()
  .transform((v, ctx): Recipe | null | undefined => {
    if (v === undefined || v === null) return undefined;
    let json: string;
    try {
      json = JSON.stringify(v) ?? '';
    } catch {
      // Pathologically deep nesting overflows the stack in JSON.stringify; same wording parseRecipe uses for depth.
      raw(ctx, 'recipe: nested too deeply');
      return null;
    }
    if (Buffer.byteLength(json, 'utf8') > MAX_RECIPE_BYTES) {
      raw(ctx, 'recipe: must be at most 2 MB');
      return null;
    }
    return recipeOrIssues(parseRecipe(v), ctx);
  });

/** Form and JSON API fields for a bot submission. */
export const BotInputSchema = z
  .object({
    name: text(1, 80),
    tagline: text(1, 200),
    descriptionMd: z.preprocess(
      (v) => (v === undefined || v === null ? '' : v),
      z.string({ invalid_type_error: 'must be text' }).max(20000, 'must be at most 20000 characters'),
    ),
    category: z.string({ required_error: 'is required', invalid_type_error: 'must be text' }).refine(isCategory, {
      message: `must be one of ${CATEGORIES.map((c) => c.id).join(', ')}`,
    }),
    tags,
    authorName: text(1, 80),
    authorUrl: optUrl,
    imageUrl: optUrl,
    sourceUrl: optUrl,
    homepageUrl: optUrl,
    avatarShape: optShort,
    avatarColor: optShort,
    templateRef,
    recipeText,
    recipe: recipeObject,
  })
  .transform(({ templateRef: templateId, recipeText: fromText, recipe: fromObject, ...rest }, ctx) => {
    const recipe = fromText !== undefined ? fromText : (fromObject ?? null);
    if (!templateId && !recipe) raw(ctx, 'Provide a template link or a recipe');
    return { ...rest, templateId, recipe };
  });

export type BotFromInputResult = { ok: true; bot: NewBot } | { ok: false; errors: string[] };

export function botFromInput(input: unknown): BotFromInputResult {
  const result = BotInputSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map((i) =>
      (i.code === z.ZodIssueCode.custom && i.params?.raw) || i.path.length === 0 ? i.message : `${String(i.path[0])}: ${i.message}`,
    );
    return { ok: false, errors: [...new Set(errors)] };
  }
  const v = result.data;
  const bot: NewBot = {
    name: v.name,
    tagline: v.tagline,
    descriptionMd: v.descriptionMd,
    category: v.category as NewBot['category'],
    tags: v.tags,
    authorName: v.authorName,
    authorUrl: v.authorUrl,
    avatarShape: v.avatarShape ?? v.recipe?.profile.avatarShape ?? null,
    avatarColor: v.avatarColor ?? v.recipe?.profile.avatarColor ?? null,
    imageUrl: v.imageUrl,
    templateId: v.templateId,
    recipe: v.recipe,
    sourceUrl: v.sourceUrl,
    homepageUrl: v.homepageUrl,
  };
  return { ok: true, bot };
}
