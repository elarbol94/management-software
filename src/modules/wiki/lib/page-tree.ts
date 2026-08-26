type TreeInput = { id: string; parentId: string | null; sortOrder: number; createdAt: number };

/**
 * Flattens pages into display order, depth-first, siblings by sortOrder then createdAt.
 * Pages whose parent is missing from the input (deleted, or filtered out) are kept as roots
 * rather than dropped, so no page can disappear from the list.
 */
export function buildPageTree<T extends TreeInput>(pages: T[]): Array<T & { depth: number }> {
  const byParent = new Map<string | null, T[]>();
  const known = new Set(pages.map((page) => page.id));
  for (const page of pages) {
    const parentId = page.parentId && known.has(page.parentId) ? page.parentId : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(page);
    byParent.set(parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  }
  const rows: Array<T & { depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const page of byParent.get(parentId) ?? []) {
      rows.push({ ...page, depth });
      walk(page.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
