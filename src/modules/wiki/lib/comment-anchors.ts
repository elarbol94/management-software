export type NormalizedRect = { x: number; y: number; width: number; height: number };
export type PageCommentAnchor = { type: "page" };
export type TextCommentAnchor = { type: "text"; quote: string };
export type ImageCommentAnchor = { type: "image"; nodeId: string; mode: "whole" | "region"; rect?: NormalizedRect; label: string };
export type CommentAnchor = PageCommentAnchor | TextCommentAnchor | ImageCommentAnchor;
export type StoredCommentAnchorData = { mode?: "whole" | "region"; rect?: NormalizedRect; label?: string };
export type CommentBadgePoint = { id: string; x: number; y: number };
export type CommentBadgeCluster = { ids: string[]; x: number; y: number };

export function normalizeImageRect(
  drag: { startX: number; startY: number; endX: number; endY: number },
  bounds: { width: number; height: number },
): NormalizedRect {
  const clamp = (value: number, maximum: number) => Math.min(maximum, Math.max(0, value));
  const startX = clamp(drag.startX, bounds.width);
  const endX = clamp(drag.endX, bounds.width);
  const startY = clamp(drag.startY, bounds.height);
  const endY = clamp(drag.endY, bounds.height);
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  return {
    x: left / bounds.width,
    y: top / bounds.height,
    width: Math.abs(endX - startX) / bounds.width,
    height: Math.abs(endY - startY) / bounds.height,
  };
}


export function clusterCommentBadges(points: readonly CommentBadgePoint[], threshold = 24): CommentBadgeCluster[] {
  const ordered = [...points].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const clusters: CommentBadgeCluster[] = [];
  for (const point of ordered) {
    const cluster = clusters.find((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= threshold);
    if (cluster) cluster.ids.push(point.id);
    else clusters.push({ ids: [point.id], x: point.x, y: point.y });
  }
  return clusters;
}


export function mergeCommentThreadIds(attrs: { threadId?: unknown; threadIds?: unknown }, nextThreadId: string): string[] {
  const ids: string[] = [];
  if (typeof attrs.threadId === "string") ids.push(attrs.threadId);
  if (Array.isArray(attrs.threadIds)) for (const id of attrs.threadIds) if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  if (!ids.includes(nextThreadId)) ids.push(nextThreadId);
  return ids;
}

export function isCommentAnchorOrphaned(
  threadId: string,
  anchor: CommentAnchor,
  document: { threadIds: ReadonlySet<string>; nodeIds: ReadonlySet<string>; text: string },
): boolean {
  if (anchor.type === "page") return false;
  if (anchor.type === "image") return !document.nodeIds.has(anchor.nodeId);
  return !document.threadIds.has(threadId) && !document.text.includes(anchor.quote);
}
