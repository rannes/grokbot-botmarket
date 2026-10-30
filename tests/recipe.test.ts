import { describe, it, expect } from 'vitest';
import { parseRecipe, parseRecipeText, recipeCounts, RecipeSchema } from '../src/core/recipe.js';

const bundle = {"format":"grokbot-bundle/v1","exportedAt":"2026-10-07T14:41:05.241Z","source":{"platform":"grok-bot","agentId":"4cb4dc74"},"persona":{"name":"Side","title":"","description":"One job: be the side chat."},"memories":[{"kind":"profile","text":"Likes short answers."}],"skills":[{"name":"getting-started","description":"First conversation after import.","body":"# Getting started\nAsk what to call you."}],"routines":[{"name":"morning-quiet-check","schedule":"47 8 * * 1-5","prompt":"If there is nothing useful to say, stay quiet."}],"plugins":[{"id":"example-mcp-hint","note":"Placeholder"}],"omitted":[]};

function ok(input: unknown) {
  const r = parseRecipe(input);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.recipe;
}
function errs(input: unknown) {
  const r = parseRecipe(input);
  if (r.ok) throw new Error('expected failure');
  return r.errors;
}

describe('parseRecipe', () => {
  it('accepts a minimal recipe and fills defaults', () => {
    const r = ok({ profile: { name: 'A', description: 'B' } });
    expect(r).toEqual({ format: 'grokbot-recipe/v1', profile: { name: 'A', description: 'B' }, memory: [], skills: [], routines: [], plugins: [] });
  });

  it('accepts a full canonical recipe and exposes RecipeSchema', () => {
    const full = {
      format: 'grokbot-recipe/v1',
      profile: { name: 'Release Notes Bot', description: 'Drafts.', avatarShape: 'capsule', avatarColor: 'blue' },
      memory: [{ content: 'Weekly.', kind: 'profile', createdAt: '2026-10-01' }],
      skills: [{ name: 's', description: 'd', content: '# Steps' }],
      routines: [{ name: 'r', content: 'go', schedule: '0 9 * * 4', timezone: 'Europe/Tallinn', enabled: false }],
      plugins: [{ pluginId: '32661537', name: 'GitHub', description: 'x' }],
      gettingStarted: { skill: 's' },
      setupNotes: 'Needs access.',
    };
    expect(ok(full)).toEqual(full);
    expect(RecipeSchema.safeParse(full).success).toBe(true);
  });

  it('accepts memory as a bare string', () => {
    expect(ok({ profile: { name: 'A', description: '' }, memory: 'Remember me' }).memory).toEqual([{ content: 'Remember me' }]);
  });

  it('accepts memory as an array of strings', () => {
    expect(ok({ profile: { name: 'A', description: '' }, memory: ['a', 'b'] }).memory).toEqual([{ content: 'a' }, { content: 'b' }]);
  });

  it('maps skill body to content', () => {
    expect(ok({ profile: { name: 'A', description: '' }, skills: [{ name: 's', body: 'text' }] }).skills).toEqual([{ name: 's', content: 'text' }]);
  });

  it('maps routine prompt to content', () => {
    expect(ok({ profile: { name: 'A', description: '' }, routines: [{ name: 'r', prompt: 'do it' }] }).routines).toEqual([{ name: 'r', content: 'do it' }]);
  });

  it('accepts gettingStarted as a bare string', () => {
    expect(ok({ profile: { name: 'A', description: '' }, gettingStarted: 'intro' }).gettingStarted).toEqual({ skill: 'intro' });
  });

  it('drops optional strings that are empty after trim', () => {
    const r = ok({ profile: { name: 'A', description: '', avatarColor: '  ' }, setupNotes: '', skills: [{ name: 's', description: ' ', content: 'c' }] });
    expect(r.profile).toEqual({ name: 'A', description: '' });
    expect(r.setupNotes).toBeUndefined();
    expect(r.skills[0]).toEqual({ name: 's', content: 'c' });
  });

  it('converts the grokbot-bundle/v1 format', () => {
    const r = ok(bundle);
    expect(r.format).toBe('grokbot-recipe/v1');
    expect(r.profile).toEqual({ name: 'Side', description: 'One job: be the side chat.' });
    expect(r.memory).toEqual([{ kind: 'profile', content: 'Likes short answers.' }]);
    expect(r.skills).toEqual([{ name: 'getting-started', description: 'First conversation after import.', content: '# Getting started\nAsk what to call you.' }]);
    expect(r.routines).toEqual([{ name: 'morning-quiet-check', content: 'If there is nothing useful to say, stay quiet.', schedule: '47 8 * * 1-5' }]);
    expect(r.plugins).toEqual([{ pluginId: 'example-mcp-hint', name: 'example-mcp-hint', description: 'Placeholder' }]);
  });

  it('maps bundle routine triggerSummary to description and plugin name', () => {
    const r = ok({ format: 'grokbot-bundle/v1', persona: { name: 'X', description: 'd' }, routines: [{ name: 'r', triggerSummary: 'daily', prompt: 'p' }], plugins: [{ id: 'i', name: 'Nice' }] });
    expect(r.routines[0]).toEqual({ name: 'r', description: 'daily', content: 'p' });
    expect(r.plugins[0]).toEqual({ pluginId: 'i', name: 'Nice' });
  });

  it('rejects profile name over 200 chars with a readable message', () => {
    const e = errs({ profile: { name: 'x'.repeat(201), description: '' } });
    expect(e).toContain('profile.name: must be 1-200 characters');
  });

  it('rejects empty profile name', () => {
    expect(errs({ profile: { name: '', description: '' } })).toContain('profile.name: must be 1-200 characters');
  });

  it('rejects more than 64 skills', () => {
    const skills = Array.from({ length: 65 }, (_, i) => ({ name: `s${i}`, content: 'c' }));
    expect(errs({ profile: { name: 'A', description: '' }, skills }).join(' ')).toMatch(/skills/);
  });

  it('rejects __proto__, constructor and prototype keys anywhere', () => {
    const evil = JSON.parse('{"profile":{"name":"A","description":"","x":{"__proto__":{"a":1}}}}');
    expect(errs(evil).join(' ')).toMatch(/__proto__/);
    expect(errs({ profile: { name: 'A', description: '' }, skills: [{ name: 's', content: 'c', constructor: 1 }] }).join(' ')).toMatch(/constructor/);
    expect(errs({ profile: { name: 'A', description: '' }, memory: [{ content: 'c', prototype: 1 }] }).join(' ')).toMatch(/prototype/);
  });

  it('rejects a missing profile', () => {
    expect(errs({ memory: [] }).length).toBeGreaterThan(0);
  });

  it('rejects non-objects', () => {
    for (const v of [null, 'x', 5, [], undefined]) expect(errs(v).length).toBeGreaterThan(0);
  });

  it('rejects an unsupported format', () => {
    expect(errs({ format: 'other/v9', profile: { name: 'A', description: '' } }).join(' ')).toMatch(/format/);
  });
});

describe('parseRecipeText', () => {
  it('parses valid JSON', () => {
    const r = parseRecipeText(JSON.stringify({ profile: { name: 'A', description: 'B' } }));
    expect(r.ok).toBe(true);
  });

  it('rejects invalid JSON with a readable error', () => {
    const r = parseRecipeText('{nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/not valid JSON/i);
  });

  it('rejects text over 2 MB', () => {
    const r = parseRecipeText(' '.repeat(2 * 1024 * 1024 + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/2 MB/);
  });
});

describe('recipeCounts', () => {
  it('counts items', () => {
    expect(recipeCounts(ok(bundle))).toEqual({ memory: 1, skills: 1, routines: 1, plugins: 1 });
  });
});
