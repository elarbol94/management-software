"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useFormatter, useTranslations } from "next-intl";
import { CheckCircle2, Circle, CornerDownRight, MessageSquareText } from "lucide-react";
import { useRouter } from "next/navigation";
import { addComment, setCommentResolved } from "../research-actions";
import { filterCommentThreads, layoutCommentCards, partitionCommentThreads, type CommentCardLayout } from "../lib/comment-layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { CommentAnchor } from "../lib/comment-anchors";

export type CommentThread = {
  id: string;
  anchorQuote: string;
  anchorType: "page" | "text" | "image";
  anchor: CommentAnchor;
  orphaned: boolean;
  resolvedAt: Date | null;
  assigneeId: string | null;
  createdAt: Date;
  createdByName: string;
  comments: Array<{ id: string; body: string; createdAt: Date; createdByName: string }>;
};

export type CommentRailHandle = {
  focusGeneralComment: () => void;
  openMobile: () => void;
  activateThread: (threadId: string) => void;
};

type AnchorMeasurement = { top: number; x: number };

function markThreadIds(element: HTMLElement) {
  return [...new Set([
    ...(element.dataset.commentThreads ?? "").split(/\s+/).filter(Boolean),
    ...(element.dataset.commentThread ? [element.dataset.commentThread] : []),
  ])];
}

function findAnchor(root: HTMLElement | null, thread: Pick<CommentThread, "id" | "anchor">) {
  if (!root) return null;
  if (thread.anchor.type === "image") {
    const nodeId = thread.anchor.nodeId;
    return [...root.querySelectorAll<HTMLElement>("[data-comment-node-id]")]
      .find((element) => element.dataset.commentNodeId === nodeId) ?? null;
  }
  if (thread.anchor.type === "text") {
    return [...root.querySelectorAll<HTMLElement>("mark[data-comment-thread], mark[data-comment-threads]")]
      .find((element) => markThreadIds(element).includes(thread.id)) ?? null;
  }
  return null;
}

function CommentCard({ thread, active, orphaned, onActivate, onReply, onResolve, cardRef }: {
  thread: CommentThread;
  active: boolean;
  orphaned: boolean;
  onActivate: () => void;
  onReply: (body: string) => Promise<void>;
  onResolve: () => Promise<void>;
  cardRef?: (element: HTMLDivElement | null) => void;
}) {
  const t = useTranslations("wiki");
  const format = useFormatter();
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);

  return <div
    ref={cardRef}
    data-testid={`comment-card-${thread.id}`}
    data-comment-thread={thread.id}
    className={cn("rounded-lg border p-3 text-xs shadow-sm transition", thread.resolvedAt ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30", active && (thread.resolvedAt ? "ring-2 ring-emerald-300" : "ring-2 ring-amber-300"))}
    onClick={onActivate}
  >
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="font-semibold text-foreground">{thread.anchor.type === "page" ? t("commentRail.generalComment") : thread.anchor.type === "image" ? t("commentRail.imageComment") : t("commentRail.textComment")}</span>
      <span className={cn("inline-flex items-center gap-1 text-[10px]", thread.resolvedAt ? "text-emerald-600" : "text-muted-foreground")}>
        {thread.resolvedAt ? <CheckCircle2 className="size-3" /> : <Circle className="size-3" />}
        {thread.resolvedAt ? t("commentRail.resolved") : t("commentRail.open")}
      </span>
    </div>
    {thread.anchor.type !== "page" && <blockquote className={cn("mb-2 line-clamp-3 border-l-2 pl-2 italic text-muted-foreground", thread.resolvedAt ? "border-emerald-400" : "border-amber-400")}>“{thread.anchor.type === "text" ? thread.anchor.quote : thread.anchor.label}”</blockquote>}
    {orphaned && <p className="mb-2 rounded bg-amber-50 px-2 py-1 font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">{t("orphaned")}</p>}
    <div className="space-y-2">
      {thread.comments.map((comment, index) => <div key={comment.id} className={cn(index > 0 && "border-l pl-2")}>
        <p className="whitespace-pre-wrap text-foreground">{comment.body}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">{comment.createdByName} · {format.dateTime(new Date(comment.createdAt), { dateStyle: "medium", timeStyle: "short" })}</p>
      </div>)}
    </div>
    {active && <div className="mt-3 border-t pt-3" onClick={(event) => event.stopPropagation()}>
      <Textarea data-testid={`comment-reply-${thread.id}`} value={reply} onChange={(event) => setReply(event.target.value)} rows={2} placeholder={t("commentRail.replyPlaceholder")} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={async () => { setPending(true); try { await onResolve(); } finally { setPending(false); } }}>{thread.resolvedAt ? t("reopen") : t("resolve")}</Button>
        <Button type="button" size="xs" disabled={!reply.trim() || pending} onClick={async () => { setPending(true); try { await onReply(reply.trim()); setReply(""); } finally { setPending(false); } }}><CornerDownRight className="size-3" />{t("commentRail.reply")}</Button>
      </div>
    </div>}
  </div>;
}

export const CommentRail = forwardRef<CommentRailHandle, {
  pageId: string;
  comments: CommentThread[];
  editor: Editor;
  editorRootRef: React.RefObject<HTMLDivElement | null>;
  activeThreadId: string | null;
  onActiveThreadChange: (threadId: string) => void;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}>(({ pageId, comments, editor, editorRootRef, activeThreadId, onActiveThreadChange, visible: commentsVisible, onVisibleChange }, ref) => {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [includeResolved, setIncludeResolved] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [generalBody, setGeneralBody] = useState("");
  const [anchors, setAnchors] = useState<Record<string, AnchorMeasurement>>({});
  const [layouts, setLayouts] = useState<CommentCardLayout[]>([]);
  const [railHeight, setRailHeight] = useState(448);
  const [pendingGeneral, setPendingGeneral] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const desktopGeneralRef = useRef<HTMLTextAreaElement>(null);
  const mobileGeneralRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const cardObserverRef = useRef<ResizeObserver | null>(null);

  const visible = useMemo(() => filterCommentThreads(comments, includeResolved), [comments, includeResolved]);
  const anchoredIds = useMemo(() => new Set(Object.keys(anchors)), [anchors]);
  const partitioned = useMemo(() => partitionCommentThreads(visible, anchoredIds), [visible, anchoredIds]);
  const unresolvedCount = comments.filter((thread) => !thread.resolvedAt).length;

  const measure = useCallback(() => {
    if (!commentsVisible) { setAnchors({}); setLayouts([]); return; }
    const root = editorRootRef.current;
    const rail = railRef.current;
    if (!root || !rail) return;
    const rootRect = root.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const nextAnchors: Record<string, AnchorMeasurement> = {};
    for (const thread of visible) {
      if (thread.anchor.type === "page" || thread.orphaned) continue;
      const element = findAnchor(root, thread);
      if (!element) continue;
      const media = thread.anchor.type === "image" ? element.querySelector("img") ?? element : element;
      const baseRect = media.getBoundingClientRect();
      const rect = thread.anchor.type === "image" && thread.anchor.mode === "region" && thread.anchor.rect
        ? {
            top: baseRect.top + baseRect.height * thread.anchor.rect.y,
            right: baseRect.left + baseRect.width * (thread.anchor.rect.x + thread.anchor.rect.width),
            height: baseRect.height * thread.anchor.rect.height,
          }
        : baseRect;
      nextAnchors[thread.id] = { top: rect.top - rootRect.top + rect.height / 2, x: rect.right - railRect.left };
    }
    const nextAnchoredIds = new Set(Object.keys(nextAnchors));
    const nextPartition = partitionCommentThreads(visible, nextAnchoredIds);
    const startTop = (pinnedRef.current?.offsetHeight ?? 0) + 12;
    const nextLayouts = layoutCommentCards(nextPartition.anchored.map((thread) => ({
      id: thread.id,
      anchorTop: nextAnchors[thread.id].top,
      height: cardRefs.current.get(thread.id)?.offsetHeight ?? 160,
    })), { startTop, minGap: 12 });
    const last = nextLayouts.at(-1);
    setAnchors(nextAnchors);
    setLayouts(nextLayouts);
    setRailHeight(Math.max(root.offsetHeight, last ? last.top + last.height : startTop, 448));
  }, [editorRootRef, visible, commentsVisible]);

  useEffect(() => {
    if (!commentsVisible) return;
    const root = editorRootRef.current;
    if (!root) return;
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    cardObserverRef.current = observer;
    observer.observe(root);
    if (pinnedRef.current) observer.observe(pinnedRef.current);
    for (const card of cardRefs.current.values()) observer.observe(card);
    editor.on("update", schedule);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      cardObserverRef.current = null;
      editor.off("update", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, editorRootRef, measure, visible, commentsVisible]);

  useEffect(() => {
    if (!commentsVisible) return;
    const root = editorRootRef.current;
    if (!root) return;
    const click = (event: MouseEvent) => {
      const mark = (event.target as Element).closest<HTMLElement>("mark[data-comment-thread], mark[data-comment-threads]");
      const threadId = mark ? markThreadIds(mark)[0] : undefined;
      if (!threadId) return;
      onActiveThreadChange(threadId);
      if (!window.matchMedia("(min-width: 1280px)").matches) setMobileOpen(true);
    };
    root.addEventListener("click", click);
    return () => { root.removeEventListener("click", click); };
  }, [editorRootRef, onActiveThreadChange, commentsVisible]);

  useEffect(() => {
    if (!commentsVisible) return;
    const root = editorRootRef.current;
    if (!root) return;
    const marks = root.querySelectorAll<HTMLElement>("mark[data-comment-thread], mark[data-comment-threads]");
    const media = root.querySelectorAll<HTMLElement>("[data-comment-node-id]");
    marks.forEach((mark) => {
      const ids = markThreadIds(mark);
      mark.classList.toggle("is-active", !!activeThreadId && ids.includes(activeThreadId));
      mark.classList.toggle("is-resolved", ids.some((id) => comments.find((item) => item.id === id)?.resolvedAt));
    });
    media.forEach((element) => {
      const thread = comments.find((item) => item.id === activeThreadId);
      element.classList.toggle("is-comment-active", thread?.anchor.type === "image" && element.dataset.commentNodeId === thread.anchor.nodeId);
      element.classList.toggle("is-comment-resolved", comments.some((item) => item.resolvedAt && item.anchor.type === "image" && item.anchor.nodeId === element.dataset.commentNodeId));
    });
    return () => { marks.forEach((mark) => mark.classList.remove("is-active", "is-resolved")); media.forEach((element) => element.classList.remove("is-comment-active", "is-comment-resolved")); };
  }, [activeThreadId, comments, editorRootRef, editor.state.doc.content.size, commentsVisible]);

  useImperativeHandle(ref, () => ({
    focusGeneralComment() {
      if (window.matchMedia("(min-width: 1280px)").matches) {
        desktopGeneralRef.current?.focus();
        desktopGeneralRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setMobileOpen(true);
        requestAnimationFrame(() => mobileGeneralRef.current?.focus());
      }
    },
    openMobile() { if (!window.matchMedia("(min-width: 1280px)").matches) setMobileOpen(true); },
    activateThread(threadId) {
      onActiveThreadChange(threadId);
      if (!window.matchMedia("(min-width: 1280px)").matches) setMobileOpen(true);
    },
  }), [onActiveThreadChange]);

  const activate = (threadId: string) => {
    onActiveThreadChange(threadId);
    const thread = comments.find((item) => item.id === threadId);
    if (thread) findAnchor(editorRootRef.current, thread)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const reply = async (threadId: string, body: string) => { await addComment({ pageId, threadId, body }); router.refresh(); };
  const resolve = async (thread: CommentThread) => { await setCommentResolved(thread.id, !thread.resolvedAt); router.refresh(); };
  const submitGeneral = async () => {
    if (!generalBody.trim()) return;
    setPendingGeneral(true);
    try { const result = await addComment({ pageId, body: generalBody.trim(), anchor: { type: "page" } }); setGeneralBody(""); onActiveThreadChange(result.threadId); router.refresh(); }
    finally { setPendingGeneral(false); }
  };

  const header = (textareaRef: React.RefObject<HTMLTextAreaElement | null>, testId: string) => <>
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="size-4 text-indigo-500" />{t("comments")}<span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal">{unresolvedCount}</span></h2>
      <Button data-testid="comment-filter-resolved" type="button" size="xs" variant={includeResolved ? "secondary" : "ghost"} onClick={() => setIncludeResolved((value) => !value)}>{includeResolved ? t("commentRail.hideResolved") : t("commentRail.showResolved")}</Button>
    </div>
    <Textarea data-testid={testId} ref={textareaRef} value={generalBody} onChange={(event) => setGeneralBody(event.target.value)} rows={3} placeholder={t("pageCommentPlaceholder")} />
    <Button type="button" size="sm" disabled={!generalBody.trim() || pendingGeneral} onClick={submitGeneral}>{t("addComment")}</Button>
  </>;

  const renderCard = (thread: CommentThread, desktop: boolean, missingAnchor = false) => <CommentCard
    key={thread.id}
    thread={thread}
    active={activeThreadId === thread.id}
    orphaned={thread.orphaned || (thread.anchor.type !== "page" && missingAnchor)}
    onActivate={() => activate(thread.id)}
    onReply={(body) => reply(thread.id, body)}
    onResolve={() => resolve(thread)}
    cardRef={desktop ? (element) => { const previous = cardRefs.current.get(thread.id); if (previous && previous !== element) cardObserverRef.current?.unobserve(previous); if (element) { cardRefs.current.set(thread.id, element); cardObserverRef.current?.observe(element); } else cardRefs.current.delete(thread.id); } : undefined}
  />;

  return <>
    {commentsVisible && <aside ref={railRef} data-testid="comment-rail" className="relative hidden w-72 xl:block" style={{ minHeight: railHeight }}>
      <div ref={pinnedRef} className="space-y-3">
        {header(desktopGeneralRef, "page-comment-input")}
        {partitioned.pinned.map((thread) => renderCard(thread, true, thread.anchor.type !== "page" && !anchoredIds.has(thread.id)))}
        {visible.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{t("commentRail.noOpenComments")}</p>}
      </div>
      <svg data-testid="comment-connectors" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {layouts.map((layout) => {
          const anchor = anchors[layout.id];
          if (!anchor) return null;
          return <path key={layout.id} data-comment-thread={layout.id} d={`M ${anchor.x} ${anchor.top} C ${anchor.x + 18} ${anchor.top}, -18 ${layout.top + 24}, 0 ${layout.top + 24}`} fill="none" stroke="currentColor" strokeWidth="0.5" className={cn(partitioned.anchored.find((item) => item.id === layout.id)?.resolvedAt ? "text-emerald-500" : "text-amber-500")} />;
        })}
      </svg>
      {layouts.map((layout) => {
        const thread = partitioned.anchored.find((item) => item.id === layout.id);
        return thread ? <div key={thread.id} className="absolute inset-x-0" style={{ top: layout.top }}>{renderCard(thread, true)}</div> : null;
      })}
    </aside>}

    <Button type="button" data-testid="mobile-comments-button" variant="outline" size="sm" className="xl:hidden" onClick={() => commentsVisible ? setMobileOpen(true) : onVisibleChange(true)}><MessageSquareText className="size-4" />{commentsVisible ? `${t("comments")} (${unresolvedCount})` : t("showComments")}</Button>
    <Sheet open={commentsVisible && mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent data-testid="comment-sheet" initialFocus={mobileGeneralRef} side="right" className="w-[min(92vw,26rem)] overflow-y-auto p-4 xl:hidden">
        <SheetHeader className="p-0"><SheetTitle>{t("commentRail.mobileTitle")}</SheetTitle><SheetDescription>{t("commentRail.mobileDescription")}</SheetDescription></SheetHeader>
        <div className="space-y-3">
          {header(mobileGeneralRef, "mobile-page-comment-input")}
          {partitioned.pinned.map((thread) => renderCard(thread, false, thread.anchor.type !== "page" && !anchoredIds.has(thread.id)))}
          {partitioned.anchored.map((thread) => renderCard(thread, false))}
          {visible.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{t("commentRail.noOpenComments")}</p>}
        </div>
      </SheetContent>
    </Sheet>
  </>;
});

CommentRail.displayName = "CommentRail";
