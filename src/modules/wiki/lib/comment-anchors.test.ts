import { describe, expect, it } from "vitest";
import { clusterCommentBadges, isCommentAnchorOrphaned, mergeCommentThreadIds, normalizeImageRect } from "./comment-anchors";

describe("normalizeImageRect", () => {
  it("normalizes a reverse drag into clamped image coordinates", () => {
    expect(normalizeImageRect({ startX: 180, startY: 90, endX: -20, endY: 30 }, { width: 200, height: 100 })).toEqual({
      x: 0,
      y: 0.3,
      width: 0.9,
      height: 0.6,
    });
  });
});


describe("clusterCommentBadges", () => {
  it("groups colliding anchors and keeps distant anchors separate in document order", () => {
    expect(clusterCommentBadges([
      { id: "later", x: 106, y: 42 },
      { id: "first", x: 100, y: 40 },
      { id: "distant", x: 100, y: 100 },
    ], 16)).toEqual([
      { ids: ["first", "later"], x: 100, y: 40 },
      { ids: ["distant"], x: 100, y: 100 },
    ]);
  });
});


describe("mergeCommentThreadIds", () => {
  it("preserves legacy and overlapping thread ids without duplicates", () => {
    expect(mergeCommentThreadIds({ threadId: "legacy", threadIds: ["existing", "legacy"] }, "new-thread")).toEqual(["legacy", "existing", "new-thread"]);
  });
});

describe("isCommentAnchorOrphaned", () => {
  const document = { threadIds: new Set(["text-mark"]), nodeIds: new Set(["image-node"]), text: "A recoverable quote" };

  it("never orphans page comments and tracks text marks, quote recovery, and image nodes", () => {
    expect(isCommentAnchorOrphaned("page", { type: "page" }, document)).toBe(false);
    expect(isCommentAnchorOrphaned("text-mark", { type: "text", quote: "missing" }, document)).toBe(false);
    expect(isCommentAnchorOrphaned("recovered", { type: "text", quote: "recoverable quote" }, document)).toBe(false);
    expect(isCommentAnchorOrphaned("removed", { type: "text", quote: "missing" }, document)).toBe(true);
    expect(isCommentAnchorOrphaned("image", { type: "image", nodeId: "image-node", mode: "whole", label: "Diagram" }, document)).toBe(false);
    expect(isCommentAnchorOrphaned("image", { type: "image", nodeId: "removed-node", mode: "whole", label: "Diagram" }, document)).toBe(true);
  });
});
