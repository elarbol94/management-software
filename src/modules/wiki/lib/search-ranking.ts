/**
 * Merges several independently ranked result lists into one order.
 *
 * bm25() scores are not comparable between FTS5 tables — each has its own column
 * weights and corpus statistics — so a page scoring -1.2 and a PDF page scoring -8.4
 * say nothing about which should come first. Reciprocal rank fusion sidesteps that by
 * scoring on position rather than value: an item's contribution is 1/(k + rank), summed
 * across every list it appears in.
 *
 * k dampens the top of each list so a single first place cannot dominate; 60 is the
 * value from the original TREC paper and behaves well without tuning.
 */
export function fuseRankings<T>(
  lists: Array<readonly T[]>,
  keyOf: (item: T) => string,
  k = 60,
): T[] {
  const scores = new Map<string, { item: T; score: number; best: number }>();
  for (const list of lists) {
    list.forEach((item, index) => {
      const key = keyOf(item);
      const contribution = 1 / (k + index + 1);
      const existing = scores.get(key);
      if (existing) {
        existing.score += contribution;
        existing.best = Math.min(existing.best, index);
      } else {
        scores.set(key, { item, score: contribution, best: index });
      }
    });
  }
  return [...scores.values()]
    // Ties break on the better original position, so the order is stable rather than
    // dependent on Map insertion order.
    .sort((a, b) => b.score - a.score || a.best - b.best)
    .map((entry) => entry.item);
}
