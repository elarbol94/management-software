export type CommentThreadSummary = {
  id: string;
  anchorType: "page" | "text" | "image";
  orphaned: boolean;
  resolvedAt: unknown | null;
};

export type CommentCardInput = {
  id: string;
  anchorTop: number;
  height: number;
};

export type CommentCardLayout = CommentCardInput & {
  top: number;
};

export function filterCommentThreads<T extends CommentThreadSummary>(threads: readonly T[], includeResolved: boolean): T[] {
  return threads.filter((thread) => includeResolved || thread.resolvedAt === null);
}

export function partitionCommentThreads<T extends CommentThreadSummary>(threads: readonly T[], anchoredThreadIds: ReadonlySet<string>): { pinned: T[]; anchored: T[] } {
  const pinned: T[] = [];
  const anchored: T[] = [];

  for (const thread of threads) {
    if (thread.anchorType === "page" || thread.orphaned || !anchoredThreadIds.has(thread.id)) pinned.push(thread);
    else anchored.push(thread);
  }

  return { pinned, anchored };
}

export function layoutCommentCards(items: readonly CommentCardInput[], options: { startTop?: number; minGap?: number } = {}): CommentCardLayout[] {
  const startTop = options.startTop ?? 0;
  const minGap = options.minGap ?? 12;
  let nextTop = startTop;

  return [...items]
    .sort((a, b) => a.anchorTop - b.anchorTop || a.id.localeCompare(b.id))
    .map((item) => {
      const top = Math.max(item.anchorTop, nextTop);
      nextTop = top + item.height + minGap;
      return { ...item, top };
    });
}
