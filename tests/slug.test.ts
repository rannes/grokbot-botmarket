import { describe, expect, it } from 'vitest';
import { slugify } from '../src/core/slug.js';

describe('slugify', () => {
  it('slugifies names', () => {
    expect(slugify('  Release Notes Bot! ')).toBe('release-notes-bot');
  });
  it('falls back to bot', () => {
    expect(slugify('!!!')).toBe('bot');
  });
  it('caps length at 64 without trailing dash', () => {
    expect(slugify('x'.repeat(80)).length).toBeLessThanOrEqual(64);
    const s = slugify('a'.repeat(63) + ' b');
    expect(s.endsWith('-')).toBe(false);
    expect(s.length).toBeLessThanOrEqual(64);
  });
});
