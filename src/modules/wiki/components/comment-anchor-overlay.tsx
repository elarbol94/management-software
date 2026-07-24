"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { type NormalizedRect } from "../lib/comment-anchors";
import type { CommentThread } from "./comment-rail";
import { cn } from "@/lib/utils";
import { userMarkColorStyle, type UserMarkColor } from "@/lib/user-mark-colors";

type AnchorGeometry = {
  id: string;
  resolved: boolean;
  markColor: UserMarkColor;
  x: number;
  y: number;
  imageRect?: { left: number; top: number; width: number; height: number };
};

function markIds(element: HTMLElement) {
  return [...new Set([
    ...(element.dataset.commentThreads ?? "").split(/\s+/).filter(Boolean),
    ...(element.dataset.commentThread ? [element.dataset.commentThread] : []),
  ])];
}

function normalizedBox(rect: DOMRect, region: NormalizedRect) {
  return {
    left: rect.left + rect.width * region.x,
    top: rect.top + rect.height * region.y,
    width: rect.width * region.width,
    height: rect.height * region.height,
  };
}

export function CommentAnchorOverlay({
  comments,
  editor,
  rootRef,
  activeThreadId,
  visible = true,
}: {
  comments: CommentThread[];
  editor: Editor;
  rootRef: React.RefObject<HTMLDivElement | null>;
  activeThreadId: string | null;
  visible?: boolean;
}) {
  const [geometry, setGeometry] = useState<AnchorGeometry[]>([]);
  const visibleThreads = useMemo(() => comments.filter((thread) => !thread.orphaned && thread.anchor.type !== "page"), [comments]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const next: AnchorGeometry[] = [];

    for (const thread of visibleThreads) {
      const anchor = thread.anchor;
      if (anchor.type === "text") {
        const marks = [...root.querySelectorAll<HTMLElement>("mark[data-comment-thread], mark[data-comment-threads]")]
          .filter((mark) => markIds(mark).includes(thread.id));
        const last = marks.at(-1);
        if (!last) continue;
        const clientRects = [...last.getClientRects()];
        const rect = clientRects.at(-1) ?? last.getBoundingClientRect();
        next.push({ id: thread.id, resolved: !!thread.resolvedAt, markColor: thread.createdByMarkColor, x: rect.right - rootRect.left + 8, y: rect.top - rootRect.top - 8 });
        continue;
      }
      if (anchor.type !== "image") continue;

      const container = [...root.querySelectorAll<HTMLElement>("[data-comment-node-id]")]
        .find((element) => element.dataset.commentNodeId === anchor.nodeId);
      if (!container) continue;
      const media = container.querySelector("img") ?? container;
      const mediaRect = media.getBoundingClientRect();
      const absolute = anchor.mode === "region" && anchor.rect
        ? normalizedBox(mediaRect, anchor.rect)
        : { left: mediaRect.left, top: mediaRect.top, width: mediaRect.width, height: mediaRect.height };
      next.push({
        id: thread.id,
        resolved: !!thread.resolvedAt,
        markColor: thread.createdByMarkColor,
        x: absolute.left + absolute.width - rootRect.left + 8,
        y: absolute.top - rootRect.top - 8,
        imageRect: {
          left: absolute.left - rootRect.left,
          top: absolute.top - rootRect.top,
          width: absolute.width,
          height: absolute.height,
        },
      });
    }
    setGeometry(next);
  }, [rootRef, visibleThreads]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root.querySelectorAll("img").forEach((image) => observer.observe(image));
    editor.on("update", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off("update", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [editor, measure, rootRef]);

  if (!visible) return null;
  return <div data-testid="comment-anchor-overlay" className="pointer-events-none absolute inset-0 z-10 overflow-visible" aria-label="Anchored comments">
    {geometry.filter((item) => item.imageRect).map((item) => <div
      key={"region-" + item.id}
      data-testid={"image-comment-highlight-" + item.id}
      className={cn("absolute rounded border-2 transition", item.resolved && "opacity-60", activeThreadId === item.id && "ring-2")}
      style={{ ...item.imageRect, ...userMarkColorStyle(item.markColor), borderColor: "var(--user-mark-solid)", backgroundColor: activeThreadId === item.id ? "var(--user-mark-hover)" : "var(--user-mark-highlight)", boxShadow: activeThreadId === item.id ? "0 0 0 2px var(--user-mark-highlight)" : undefined }}
    />)}
  </div>;
}
