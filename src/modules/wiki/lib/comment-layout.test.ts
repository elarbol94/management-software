import { describe, expect, it } from "vitest";
import { filterCommentThreads, layoutCommentCards, partitionCommentThreads } from "./comment-layout";

const threads = [
  { id: "general", anchorType: "page" as const, orphaned: false, resolvedAt: null },
  { id: "open", anchorType: "text" as const, orphaned: false, resolvedAt: null },
  { id: "resolved", anchorType: "image" as const, orphaned: false, resolvedAt: new Date("2026-01-01") },
  { id: "orphaned", anchorType: "text" as const, orphaned: true, resolvedAt: null },
];

describe("filterCommentThreads", () => {
  it("shows only open threads by default and includes resolved threads on request", () => {
    expect(filterCommentThreads(threads, false).map((thread) => thread.id)).toEqual(["general", "open", "orphaned"]);
    expect(filterCommentThreads(threads, true).map((thread) => thread.id)).toEqual(["general", "open", "resolved", "orphaned"]);
  });
});

describe("partitionCommentThreads", () => {
  it("places general and orphaned threads before text- and image-bound threads", () => {
    const result = partitionCommentThreads(filterCommentThreads(threads, true), new Set(["open", "resolved"]));
    expect(result.pinned.map((thread) => thread.id)).toEqual(["general", "orphaned"]);
    expect(result.anchored.map((thread) => thread.id)).toEqual(["open", "resolved"]);
  });

  it("treats a thread whose mark is missing as orphaned for display", () => {
    const result = partitionCommentThreads([threads[1]], new Set());
    expect(result.pinned.map((thread) => thread.id)).toEqual(["open"]);
    expect(result.anchored).toEqual([]);
  });
});

describe("layoutCommentCards", () => {
  it("sorts anchors and keeps the requested minimum gap between cards", () => {
    expect(layoutCommentCards([
      { id: "later", anchorTop: 30, height: 50 },
      { id: "first", anchorTop: 10, height: 40 },
      { id: "last", anchorTop: 200, height: 30 },
    ], { startTop: 0, minGap: 12 })).toEqual([
      { id: "first", anchorTop: 10, top: 10, height: 40 },
      { id: "later", anchorTop: 30, top: 62, height: 50 },
      { id: "last", anchorTop: 200, top: 200, height: 30 },
    ]);
  });

  it("is deterministic for equal anchors and respects the pinned-card boundary", () => {
    const input = [
      { id: "b", anchorTop: 5, height: 20 },
      { id: "a", anchorTop: 5, height: 20 },
    ];
    const expected = [
      { id: "a", anchorTop: 5, top: 80, height: 20 },
      { id: "b", anchorTop: 5, top: 112, height: 20 },
    ];
    expect(layoutCommentCards(input, { startTop: 80, minGap: 12 })).toEqual(expected);
    expect(layoutCommentCards(input, { startTop: 80, minGap: 12 })).toEqual(expected);
  });
});
