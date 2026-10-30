import { z } from 'zod';

export const RECIPE_FORMAT = 'grokbot-recipe/v1' as const;
const BUNDLE_FORMAT = 'grokbot-bundle/v1';
/** Largest recipe accepted, as UTF-8 JSON text (pasted text, or a JSON API object once serialized). */
export const MAX_RECIPE_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Whitespace-only strings become undefined so optional fields are dropped. */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = (max: number) => z.preprocess(blankToUndefined, z.string().max(max).optional());

const ProfileSchema = z.object({
  name: z.string({ required_error: 'must be 1-200 characters', invalid_type_error: 'must be 1-200 characters' }).min(1, 'must be 1-200 characters').max(200, 'must be 1-200 characters'),
  description: z.string().max(20000, 'must be at most 20000 characters').default(''),
  avatarShape: optStr(100),
  avatarColor: optStr(100),
});

const MemorySchema = z.object({
  content: z.string().min(1, 'must not be empty').max(20000),
  kind: z.preprocess(blankToUndefined, z.enum(['profile', 'log']).optional()),
  createdAt: optStr(100),
});

const SkillSchema = z.object({
  name: z.string().min(1, 'must not be empty').max(200),
  description: optStr(20000),
  content: z.string().min(1, 'must not be empty').max(200000),
});

const RoutineSchema = z.object({
  name: z.string().min(1, 'must not be empty').max(200),
  description: optStr(20000),
  content: z.string().min(1, 'must not be empty').max(200000),
  schedule: optStr(200),
  timezone: optStr(100),
  enabled: z.boolean().optional(),
});

const PluginSchema = z.object({
  pluginId: optStr(200),
  name: z.string().min(1, 'must not be empty').max(200),
  description: optStr(20000),
});

export const RecipeSchema = z.object({
  format: z.literal(RECIPE_FORMAT).default(RECIPE_FORMAT),
  profile: ProfileSchema,
  memory: z.array(MemorySchema).max(200, 'must have at most 200 items').default([]),
  skills: z.array(SkillSchema).max(64, 'must have at most 64 items').default([]),
  routines: z.array(RoutineSchema).max(100, 'must have at most 100 items').default([]),
  plugins: z.array(PluginSchema).max(40, 'must have at most 40 items').default([]),
  gettingStarted: z.object({ skill: z.string().min(1).max(200) }).optional(),
  setupNotes: optStr(20000),
});

export type Recipe = z.infer<typeof RecipeSchema>;
export type ParseResult = { ok: true; recipe: Recipe } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function findForbiddenKey(v: unknown, path: string, depth = 0): string | null {
  if (depth > 64) return `${path || '(root)'}: nested too deeply`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = findForbiddenKey(v[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
  } else if (isObj(v)) {
    for (const key of Object.keys(v)) {
      const p = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.has(key)) return `${p}: key "${key}" is not allowed`;
      const hit = findForbiddenKey(v[key], p, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

const mapItems = (v: unknown, fn: (o: Obj) => Obj): unknown => (Array.isArray(v) ? v.map((x) => (isObj(x) ? fn(x) : x)) : v);

function withoutKeys(o: Obj, ...keys: string[]): Obj {
  const out: Obj = {};
  for (const k of Object.keys(o)) if (!keys.includes(k)) out[k] = o[k];
  return out;
}

function fromBundle(b: Obj): Obj {
  const persona = isObj(b.persona) ? b.persona : undefined;
  const profile = persona
    ? { name: persona.name, description: persona.description, avatarShape: persona.avatarShape, avatarColor: persona.avatarColor }
    : undefined;
  return {
    profile,
    memory: mapItems(b.memories, (m) => ({ kind: m.kind, content: m.text })),
    skills: mapItems(b.skills, (s) => ({ name: s.name, description: s.description, content: s.body ?? s.content })),
    routines: mapItems(b.routines, (r) => ({ name: r.name, description: r.triggerSummary, content: r.prompt ?? r.content, schedule: r.schedule })),
    plugins: mapItems(b.plugins, (p) => ({ pluginId: p.id, name: p.name ?? p.id, description: p.note })),
  };
}

function normalize(input: Obj): Obj {
  const src = input.profile === undefined && input.persona !== undefined ? fromBundle(input) : input;
  const out: Obj = { ...src };

  let memory = src.memory;
  if (typeof memory === 'string') memory = [memory];
  if (Array.isArray(memory)) memory = memory.map((m) => (typeof m === 'string' ? { content: m } : m));
  if (memory !== undefined) out.memory = memory;

  if (src.skills !== undefined) {
    out.skills = mapItems(src.skills, (s) => (s.content === undefined && s.body !== undefined ? { ...withoutKeys(s, 'body'), content: s.body } : s));
  }
  if (src.routines !== undefined) {
    out.routines = mapItems(src.routines, (r) => (r.content === undefined && r.prompt !== undefined ? { ...withoutKeys(r, 'prompt'), content: r.prompt } : r));
  }
  if (typeof src.gettingStarted === 'string') out.gettingStarted = { skill: src.gettingStarted };

  for (const k of ['memory', 'skills', 'routines', 'plugins']) if (out[k] === null) delete out[k];
  out.format = RECIPE_FORMAT;
  return out;
}

export function parseRecipe(input: unknown): ParseResult {
  if (!isObj(input)) return { ok: false, errors: ['recipe: must be a JSON object'] };
  const forbidden = findForbiddenKey(input, '');
  if (forbidden) return { ok: false, errors: [forbidden] };

  const fmt = input.format;
  if (fmt !== undefined && fmt !== RECIPE_FORMAT && fmt !== BUNDLE_FORMAT) {
    return { ok: false, errors: [`format: unsupported format "${String(fmt)}" (expected ${RECIPE_FORMAT})`] };
  }
  if (input.profile === undefined && input.persona === undefined) {
    return { ok: false, errors: ['profile: is required'] };
  }

  const result = RecipeSchema.safeParse(normalize(input));
  if (result.success) return { ok: true, recipe: result.data };
  const errors = result.error.issues.map((i) => {
    const path = i.path.map(String).join('.').replace(/\.(\d+)(?=\.|$)/g, '[$1]');
    return `${path || 'recipe'}: ${i.message}`;
  });
  return { ok: false, errors };
}

export function parseRecipeText(text: string): ParseResult {
  if (Buffer.byteLength(text, 'utf8') > MAX_RECIPE_BYTES) {
    return { ok: false, errors: ['recipe: file is larger than 2 MB'] };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`recipe: not valid JSON (${e instanceof Error ? e.message : 'parse error'})`] };
  }
  return parseRecipe(data);
}

export function recipeCounts(r: Recipe): { memory: number; skills: number; routines: number; plugins: number } {
  return { memory: r.memory.length, skills: r.skills.length, routines: r.routines.length, plugins: r.plugins.length };
}
