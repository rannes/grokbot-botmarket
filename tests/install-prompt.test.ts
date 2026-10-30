import { describe, expect, it } from 'vitest';
import { MAX_PROMPT_LENGTH, buildRecipeInstallPrompt } from '../src/core/install-prompt.js';
import { CATEGORIES, categoryLabel, isCategory } from '../src/core/categories.js';

describe('buildRecipeInstallPrompt', () => {
  it('stays within the limit with a 300-char url and 60-char name', () => {
    const recipeUrl = 'https://example.com/' + 'a'.repeat(280);
    const p = buildRecipeInstallPrompt({ recipeUrl, name: 'N'.repeat(60) });
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(p).toContain(recipeUrl);
  });
  it('contains url and name', () => {
    const p = buildRecipeInstallPrompt({ recipeUrl: 'https://x.test/r.json', name: 'Release Bot' });
    expect(p).toContain('https://x.test/r.json');
    expect(p).toContain('Release Bot');
    expect(p).toMatch(/paused/);
    expect(p).toMatch(/Fetch the JSON/);
    expect(p).toMatch(/memories, skills, routines and plugins/);
    expect(p).toMatch(/ask me whether to continue/);
    expect(p).toMatch(/Do not write anything until I answer yes/);
    expect(p).toMatch(/journal memory/);
    expect(p).toMatch(/one single question/);
    expect(p).toMatch(/Never install plugins or MCP servers silently/);
    expect(p).toMatch(/ready/);
  });
  it('truncates an overlong name with an ellipsis, never the url', () => {
    const recipeUrl = 'https://example.com/' + 'a'.repeat(280);
    const p = buildRecipeInstallPrompt({ recipeUrl, name: 'N'.repeat(900) });
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(p).toContain(recipeUrl);
    expect(p).toContain('…');
  });
});

describe('buildRecipeInstallPrompt limits', () => {
  it('throws RangeError when the url is too long even with a truncated name', () => {
    const recipeUrl = 'https://example.com/' + 'a'.repeat(930);
    expect(() => buildRecipeInstallPrompt({ recipeUrl, name: 'Bot' })).toThrow(RangeError);
  });
});

describe('categories', () => {
  it('validates ids', () => {
    expect(isCategory('sales')).toBe(true);
    expect(isCategory('nope')).toBe(false);
    expect(categoryLabel('recruiting-people')).toBe('Recruiting & People');
    expect(CATEGORIES).toHaveLength(9);
  });
});
