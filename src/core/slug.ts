/** Longest slug; catalog.ts's SLUG_RE enforces the same bound on import. */
export const MAX_SLUG_LENGTH = 64;

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return s || 'bot';
}
