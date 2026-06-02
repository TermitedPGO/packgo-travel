/**
 * Pure helpers for MobileMenuDrawer — kept React-free so they unit-test
 * without a DOM. (Mobile Phase 8, 2026-06-01.)
 */
export type MenuAction = {
  id: string;
  label: string;
  group: string;
  onSelect: () => void;
};

/**
 * Filter actions by a case-insensitive label substring, then group by domain
 * label preserving first-seen group order and within-group order.
 */
export function buildMenuGroups(
  actions: MenuAction[],
  query: string,
): Array<[string, MenuAction[]]> {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? actions.filter((a) => a.label.toLowerCase().includes(q))
    : actions;
  const byGroup = new Map<string, MenuAction[]>();
  for (const a of filtered) {
    const arr = byGroup.get(a.group) ?? [];
    arr.push(a);
    byGroup.set(a.group, arr);
  }
  return Array.from(byGroup.entries());
}
