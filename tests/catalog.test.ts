import { parseRecipe } from '../src/core/recipe.js';
import { describe, it, expect } from 'vitest';
import { CATALOG_FORMAT, toCatalogBot, exportCatalog, parseCatalog, catalogBotToNewBot } from '../src/core/catalog.js';
import type { Bot } from '../src/db/bots-repo.js';

const TID = 'abcdefghijklmnopqrstu';

function bot(over: Partial<Bot> = {}): Bot {
  return {
    slug: 'release-notes', name: 'Release Notes', tagline: 'Drafts notes', descriptionMd: '# Hi',
    category: 'engineering', tags: ['git'], authorName: 'Ann', authorUrl: 'https://example.com/ann',
    avatarShape: 'capsule', avatarColor: 'blue', imageUrl: null, templateId: TID, recipe: null,
    sourceUrl: null, homepageUrl: null, status: 'published', featured: true, installClicks: 7, upvotes: 3,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', ...over,
  };
}
const site = { name: 'My Market', url: 'https://market.example.com' };
const now = () => new Date('2026-10-31T12:00:00.000Z');

function failure(input: unknown): string[] {
  const r = parseCatalog(input);
  if (r.ok) throw new Error('expected failure');
  return r.errors;
}

describe('catalog', () => {
  it('toCatalogBot strips status/featured/counters and adds links', () => {
    const cb = toCatalogBot(bot());
    expect(cb).not.toHaveProperty('status');
    expect(cb).not.toHaveProperty('featured');
    expect(cb).not.toHaveProperty('installClicks');
    expect(cb).not.toHaveProperty('upvotes');
    expect(cb.installUrl).toBe(`grokbot://app/v1/bot-template?id=${TID}`);
    expect(cb.pageUrl).toBe(`https://x.ai/bot/${TID}`);
  });

  it('recipe bots get null installUrl and pageUrl', () => {
    const cb = toCatalogBot(bot({ templateId: null, recipe: { format: 'grokbot-recipe/v1', profile: { name: 'A', description: '' }, memory: [], skills: [], routines: [], plugins: [] } }));
    expect(cb.installUrl).toBeNull();
    expect(cb.pageUrl).toBeNull();
  });

  it('round-trips through JSON', () => {
    const cat = exportCatalog([bot()], site, now);
    expect(cat.format).toBe(CATALOG_FORMAT);
    expect(cat.generatedAt).toBe('2026-10-31T12:00:00.000Z');
    const r = parseCatalog(JSON.parse(JSON.stringify(cat)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.catalog).toEqual(cat);
  });

  it('rejects wrong format', () => {
    const cat = exportCatalog([bot()], site, now);
    expect(failure({ ...cat, format: 'nope/v2' }).join(' ')).toMatch(/format/);
  });

  it('rejects a bot with neither template nor recipe', () => {
    const cat = JSON.parse(JSON.stringify(exportCatalog([bot()], site, now)));
    cat.bots[0].templateId = null;
    expect(failure(cat)).toContain('bots[0]: needs templateId or recipe');
  });

  it('rejects a bad slug', () => {
    const cat = JSON.parse(JSON.stringify(exportCatalog([bot()], site, now)));
    cat.bots[0].slug = 'Bad Slug';
    expect(failure(cat).join(' ')).toMatch(/bots\[0\]\.slug/);
  });

  it('prefixes recipe errors', () => {
    const cat = JSON.parse(JSON.stringify(exportCatalog([bot()], site, now)));
    cat.bots[0].recipe = { profile: {} };
    expect(failure(cat).some((e) => e.startsWith('bots[0].recipe:'))).toBe(true);
  });

  it('applies defaults and recomputes links', () => {
    const r = parseCatalog({
      format: CATALOG_FORMAT, generatedAt: 'G', site: { name: 'S', url: null },
      bots: [{ slug: 'a', name: 'A', tagline: 'T', category: 'other', authorName: 'X', templateId: TID, installUrl: 'evil', pageUrl: 'evil' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const b = r.catalog.bots[0]!;
      expect(b.createdAt).toBe('G');
      expect(b.tags).toEqual([]);
      expect(b.descriptionMd).toBe('');
      expect(b.installUrl).toBe(`grokbot://app/v1/bot-template?id=${TID}`);
    }
  });

  it('catalogBotToNewBot returns a NewBot with slug', () => {
    const nb = catalogBotToNewBot(toCatalogBot(bot()));
    expect(nb.slug).toBe('release-notes');
    expect(nb).not.toHaveProperty('installUrl');
    expect(nb).not.toHaveProperty('createdAt');
    expect(nb.templateId).toBe(TID);
  });
  const base = () => JSON.parse(JSON.stringify(exportCatalog([bot()], site, now)));

  it('rejects duplicate slugs', () => {
    const cat = base();
    cat.bots.push({ ...cat.bots[0] });
    expect(failure(cat)).toContain('bots[1].slug: duplicate of bots[0]');
  });

  it.each(['http://example.com/a', 'javascript:alert(1)'])('rejects non-https bot URL %s', (u) => {
    for (const f of ['authorUrl', 'imageUrl', 'sourceUrl', 'homepageUrl']) {
      const cat = base();
      cat.bots[0][f] = u;
      expect(failure(cat).join(' ')).toContain(`bots[0].${f}`);
    }
  });

  it('accepts an http or https site.url, rejects other schemes', () => {
    for (const u of ['http://localhost:3000', 'https://market.example.com']) {
      const cat = base();
      cat.site.url = u;
      expect(parseCatalog(cat).ok).toBe(true);
    }
    const cat = base();
    cat.site.url = 'javascript:alert(1)';
    expect(failure(cat).join(' ')).toContain('site.url');
  });

  it('caps timestamp strings at 64 characters', () => {
    const long = 'x'.repeat(65);
    for (const mutate of [
      (c: any) => (c.generatedAt = long),
      (c: any) => (c.bots[0].createdAt = long),
      (c: any) => (c.bots[0].updatedAt = long),
    ]) {
      const cat = base();
      mutate(cat);
      expect(parseCatalog(cat).ok).toBe(false);
    }
  });

  it('round-trips a recipe bot with a normalized recipe', () => {
    const pr = parseRecipe({ profile: { name: 'A', description: 'B' }, skills: [{ name: 's', content: '# x' }] });
    if (!pr.ok) throw new Error('recipe');
    const cat = exportCatalog([bot({ templateId: null, recipe: pr.recipe })], site, now);
    const r = parseCatalog(JSON.parse(JSON.stringify(cat)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.catalog).toEqual(cat);
  });

  it('caps the number of bots at 5000', () => {
    const cat = base();
    cat.bots = Array.from({ length: 5001 }, (_, i) => ({ ...cat.bots[0], slug: `b${i}` }));
    expect(failure(cat).join(' ')).toMatch(/at most 5000/);
  });

  it('rejects too many or bad tags', () => {
    let cat = base();
    cat.bots[0].tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(failure(cat).join(' ')).toContain('bots[0].tags');
    cat = base();
    cat.bots[0].tags = [''];
    expect(failure(cat).join(' ')).toContain('bots[0].tags');
    cat = base();
    cat.bots[0].tags = ['x'.repeat(33)];
    expect(failure(cat).join(' ')).toContain('bots[0].tags');
  });

  it('rejects an invalid templateId and unknown category', () => {
    let cat = base();
    cat.bots[0].templateId = 'short';
    expect(failure(cat).join(' ')).toContain('bots[0].templateId');
    cat = base();
    cat.bots[0].category = 'nonsense';
    expect(failure(cat).join(' ')).toContain('bots[0].category');
  });

  it('rejects non-object bot entries and non-object input', () => {
    const cat = base();
    cat.bots = [null, 'x', 5];
    const e = failure(cat);
    expect(e.length).toBeGreaterThanOrEqual(3);
    expect(e.join(' ')).toContain('bots[0]');
    for (const bad of [null, 'str', 42, [], undefined]) expect(failure(bad).length).toBeGreaterThan(0);
  });

  it('caps the error list at 100 entries', () => {
    const cat = base();
    cat.bots = Array.from({ length: 300 }, () => null);
    const e = failure(cat);
    expect(e).toHaveLength(101);
    expect(e[100]).toMatch(/^\.\.\. and \d+ more$/);
  });
});
