export const CATEGORIES = [
  { id: 'engineering', label: 'Engineering' },
  { id: 'sales', label: 'Sales' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'design', label: 'Design' },
  { id: 'personal', label: 'Personal' },
  { id: 'recruiting-people', label: 'Recruiting & People' },
  { id: 'product', label: 'Product' },
  { id: 'operations', label: 'Operations' },
  { id: 'other', label: 'Other' },
] as const satisfies readonly { id: string; label: string }[];

export type Category = (typeof CATEGORIES)[number]['id'];

export function isCategory(x: unknown): x is Category {
  return typeof x === 'string' && CATEGORIES.some((c) => c.id === x);
}

export function categoryLabel(id: Category): string {
  return CATEGORIES.find((c) => c.id === id)!.label;
}
