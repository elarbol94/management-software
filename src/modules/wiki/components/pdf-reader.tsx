/* eslint-disable @next/next/no-img-element -- Authenticated PDF thumbnails and annotation crops are served by private routes. */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft, ArrowUp, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy,
  Download, ExternalLink, FileSearch, Highlighter, Keyboard, ListTree, Loader2, Menu, MessageCircle,
  Minus, MoreHorizontal, Pencil, Plus, Printer, RotateCw, Search, Trash2, X,
  SquareDashedMousePointer,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FocusModeToggle, useFocusMode } from "@/components/focus-mode";
import {
  createPdfAnnotation, createPdfAnnotationComment, deletePdfAnnotation, extendPdfAnnotation,
  restorePdfAnnotation, updatePdfAnnotation, updatePdfAnnotationComment,
} from "../pdf-actions";
import type { PdfRect } from "../lib/pdf-evidence";
import {
  calculateFitScale, findSearchOccurrences, formatPdfCitation,
  parsePdfReaderPreferences, PDF_READER_PREFERENCES_KEY, resolveInitialPage, type FitMode,
  type NavigatorTab, type PdfReaderPreferences,
} from "../lib/pdf-reader-utils";
import styles from "./pdf-reader.module.css";
import {
  USER_MARK_COLORS,
  initialsForName,
  userMarkColorStyle,
  type UserMarkColor,
} from "@/lib/user-mark-colors";

type ReaderPage = {
  pageNumber: number; width: number; height: number; text: string;
  textLayerJson: string; extractionMethod: "native" | "ocr" | "empty"; hasThumbnail: boolean;
};
type ReaderAnnotation = {
  id: string; pageNumber: number; kind: "text" | "region" | "bookmark";
  selectedText: string; note: string; label: string; color: string; geometryJson: string;
  hasPreview: boolean; createdBy: string; createdByName: string; createdByMarkColor: UserMarkColor; createdAt: string; updatedAt: string;
  comments: Array<{ id: string; body: string; createdBy: string; createdByName: string; createdByMarkColor: UserMarkColor; createdAt: string }>;
};
type PendingAnnotation = {
  kind: "text" | "region" | "bookmark"; geometry: PdfRect[]; selectedText: string;
  previewDataUrl?: string; pageNumber: number;
};
type SelectionAnchor = {
  pageNumber: number;
  x: number;
  y: number;
  side: "left" | "right";
};
type CommentPanelState = { mode: "closed" } | { mode: "list" } | { mode: "thread"; annotationId: string };

const COMMENT_PANEL_WIDTH_KEY = "wiki:pdf-comment-panel-width";
const LAST_PAGE_KEY_PREFIX = "wiki:pdf-last-page:";

function NoteMeta({ name, timestamp, markColor }: { name: string; timestamp: string; markColor: UserMarkColor }) {
  return <span className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground" style={userMarkColorStyle(markColor)}><Avatar size="sm" className="size-4 border" style={{ borderColor: "var(--user-mark-solid)" }}><AvatarFallback className="text-[8px]" style={{ color: "var(--user-mark-solid)", backgroundColor: "var(--user-mark-highlight)" }}>{initialsForName(name)}</AvatarFallback></Avatar><span>{name}</span><Clock3 className="size-3" /><time>{timestamp}</time></span>;
}

function isPdfRenderCancellation(reason: unknown) {
  return reason instanceof Error && reason.name === "RenderingCancelledException";
}

export function PdfReader({
  sourceId, sourceTitle, attachmentId, documentId, fileName, pages, initialAnnotations,
  initialPage, initialAnnotationId, user,
  hasExplicitPage = false,
}: {
  sourceId: string; sourceTitle: string; attachmentId: string; documentId: string; fileName: string;
  pages: ReaderPage[]; initialAnnotations: ReaderAnnotation[]; initialPage: number; initialAnnotationId?: string;
  hasExplicitPage?: boolean;
  user: { id: string; name: string; role?: string | null; markColor: UserMarkColor };
}) {
  const t = useTranslations("wiki"); const tMarkColor = useTranslations("settings.profile.colors"); const format = useFormatter(); const router = useRouter();
  const pdfLoadFailedMessage = t("pdfLoadFailed");
  const { isFocused } = useFocusMode();
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [thumbnailWidth, setThumbnailWidth] = useState(132);
  const [navigatorTab, setNavigatorTab] = useState<NavigatorTab>("pages");
  const [commentPanel, setCommentPanel] = useState<CommentPanelState>(() => initialAnnotationId ? { mode: "thread", annotationId: initialAnnotationId } : isFocused ? { mode: "closed" } : { mode: "list" });
  const [commentPanelWidth, setCommentPanelWidth] = useState(304);
  const [compactViewport, setCompactViewport] = useState(false);
  const [commentSearch, setCommentSearch] = useState("");
  const [currentPageCommentsOnly, setCurrentPageCommentsOnly] = useState(false);
  const previousFocused = useRef(isFocused);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const pdfjsRef = useRef<typeof import("pdfjs-dist") | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.min(Math.max(initialPage, 1), Math.max(1, pages.length)));
  const [scale, setScale] = useState(1.25); const [rotation, setRotation] = useState(0);
  const [fitMode, setFitMode] = useState<FitMode>("custom");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [outline, setOutline] = useState<Array<{ title: string; pageNumber?: number; depth: number }>>([]);
  const [outlineLoaded, setOutlineLoaded] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [continuousRenderPages, setContinuousRenderPages] = useState<number[]>([pageNumber]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [annotationKindFilter, setAnnotationKindFilter] = useState("all");
  const [annotationColorFilter, setAnnotationColorFilter] = useState("all");
  const [annotationAuthorFilter, setAnnotationAuthorFilter] = useState("all");
  const [editingAnnotation, setEditingAnnotation] = useState(false);
  const [annotationEditDraft, setAnnotationEditDraft] = useState({ label: "", note: "" });
  const scaleRef = useRef(1.25);
  const zoomFrameRef = useRef<number | null>(null);
  const pendingZoomRef = useRef<{ deltaY: number; cursorX: number; cursorY: number; viewport: HTMLDivElement } | null>(null);
  const zoomAnchorRef = useRef<{ cursorX: number; cursorY: number; shell: HTMLDivElement | null; x: number; y: number } | null>(null);
  const zoomGestureTimeoutRef = useRef<number | null>(null);
  const zoomCommitTimeoutRef = useRef<number | null>(null);
  const zoomScaleRef = useRef(1.25);
  const zoomCommitPendingRef = useRef(false);
  const zoomContentRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLButtonElement>(null);
  const [viewMode, setViewMode] = useState<"continuous" | "single" | "double">("continuous");
  const [rendering, setRendering] = useState(true); const [error, setError] = useState("");
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [activeAnnotationId, setActiveAnnotationId] = useState(initialAnnotationId ?? "");
  const [replyByAnnotation, setReplyByAnnotation] = useState<Record<string, string>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentDraftById, setCommentDraftById] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<{ text: string; rects: PdfRect[]; pageNumber: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const [selectionAnchorPosition, setSelectionAnchorPosition] = useState<{ left: number; top: number; side: SelectionAnchor["side"] } | null>(null);
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null);
  const [annotationNote, setAnnotationNote] = useState("");
  const [annotationAnchor, setAnnotationAnchor] = useState<{ left: number; top: number } | null>(null);
  const [regionMode, setRegionMode] = useState(false); const [region, setRegion] = useState<PdfRect | null>(null);
  const regionStart = useRef<{ x: number; y: number } | null>(null);
  const restoreContinuousPage = useRef<number | null>(null);
  const initialContinuousScroll = useRef(true);
  const [query, setQuery] = useState("");
  const searchOccurrences = useMemo(() => findSearchOccurrences(pages, query), [pages, query]);
  const canvasRef = useRef<HTMLCanvasElement>(null); const textLayerRef = useRef<HTMLDivElement>(null);
  const pageShellRef = useRef<HTMLDivElement>(null); const secondaryPageShellRef = useRef<HTMLDivElement>(null); const secondaryCanvasRef = useRef<HTMLCanvasElement>(null); const secondaryTextLayerRef = useRef<HTMLDivElement>(null); const continuousCanvasRefs = useRef(new Map<number, HTMLCanvasElement>()); const continuousTextLayerRefs = useRef(new Map<number, HTMLDivElement>()); const continuousPageRefs = useRef(new Map<number, HTMLDivElement>()); const continuousRenderTasksRef = useRef(new Map<number, { cancel: () => void; promise: Promise<unknown> }>()); const continuousLoadingPagesRef = useRef(new Set<number>()); const continuousRenderedPagesRef = useRef(new Set<number>()); const continuousRenderGenerationRef = useRef(0); const continuousActivePageRef = useRef(pageNumber); const viewportRef = useRef<HTMLDivElement>(null);
  const currentPage = pages.find((page) => page.pageNumber === pageNumber);
  const thumbnailResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const commentPanelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const commentPanelWidthRef = useRef(304);

  const reducedMotion = useRef(false);

  useEffect(() => { continuousActivePageRef.current = pageNumber; }, [pageNumber]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const updateCompactViewport = () => setCompactViewport(media.matches);
    const frame = window.requestAnimationFrame(() => {
      const preferences = parsePdfReaderPreferences(window.localStorage.getItem(PDF_READER_PREFERENCES_KEY));
      const legacyCommentWidth = Number(window.localStorage.getItem(COMMENT_PANEL_WIDTH_KEY));
      const nextCommentWidth = Number.isFinite(legacyCommentWidth)
        ? Math.min(420, Math.max(260, legacyCommentWidth))
        : preferences.commentPanelWidth;
      commentPanelWidthRef.current = nextCommentWidth;
      setCommentPanelWidth(nextCommentWidth);
      setThumbnailWidth(preferences.navigatorWidth);
      setShowThumbnails(preferences.navigatorVisible);
      setNavigatorTab(preferences.navigatorTab);
      setViewMode(preferences.viewMode);
      setFitMode(preferences.fitMode);
      setScale(preferences.scale);
      setRotation(preferences.rotation);
      reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!hasExplicitPage) {
        const storedPage = Number(window.localStorage.getItem(LAST_PAGE_KEY_PREFIX + documentId));
        setPageNumber(resolveInitialPage({ storedPage, pageCount: pages.length }));
      }
      setPreferencesLoaded(true);
      updateCompactViewport();
    });
    media.addEventListener("change", updateCompactViewport);
    return () => { window.cancelAnimationFrame(frame); media.removeEventListener("change", updateCompactViewport); };
  }, [documentId, hasExplicitPage, pages.length]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    const preferences: PdfReaderPreferences = {
      version: 1, viewMode, fitMode, scale, rotation,
      navigatorTab, navigatorVisible: showThumbnails, navigatorWidth: thumbnailWidth,
      commentPanelWidth,
    };
    window.localStorage.setItem(PDF_READER_PREFERENCES_KEY, JSON.stringify(preferences));
  }, [commentPanelWidth, fitMode, navigatorTab, preferencesLoaded, rotation, scale, showThumbnails, thumbnailWidth, viewMode]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    window.localStorage.setItem(LAST_PAGE_KEY_PREFIX + documentId, String(pageNumber));
  }, [documentId, pageNumber, preferencesLoaded]);

  useEffect(() => {
    const resize = (event: PointerEvent) => {
      const thumbnailStart = thumbnailResizeRef.current;
      if (thumbnailStart) setThumbnailWidth(Math.min(240, Math.max(104, thumbnailStart.startWidth + event.clientX - thumbnailStart.startX)));
      const commentStart = commentPanelResizeRef.current;
      if (commentStart) {
        const nextWidth = Math.min(420, Math.max(260, commentStart.startWidth + commentStart.startX - event.clientX));
        commentPanelWidthRef.current = nextWidth;
        setCommentPanelWidth(nextWidth);
      }
    };
    const stop = () => {
      thumbnailResizeRef.current = null;
      if (commentPanelResizeRef.current) window.localStorage.setItem(COMMENT_PANEL_WIDTH_KEY, String(commentPanelWidthRef.current));
      commentPanelResizeRef.current = null;
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", resize); window.removeEventListener("pointerup", stop); };
  }, []);

  useEffect(() => {
    if (previousFocused.current === isFocused) return;
    previousFocused.current = isFocused;
    setShowThumbnails(!isFocused);
    setCommentPanel(isFocused ? { mode: "closed" } : { mode: "list" });
  }, [isFocused]);

  useEffect(() => {
    scaleRef.current = scale;
    zoomScaleRef.current = scale;
    if (zoomCommitPendingRef.current) {
      zoomContentRef.current?.style.removeProperty("zoom");
      zoomCommitPendingRef.current = false;
    }
  }, [scale]);

  useEffect(() => () => {
    if (zoomFrameRef.current !== null) window.cancelAnimationFrame(zoomFrameRef.current);
    if (zoomGestureTimeoutRef.current !== null) window.clearTimeout(zoomGestureTimeoutRef.current);
    if (zoomCommitTimeoutRef.current !== null) window.clearTimeout(zoomCommitTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!selectionAnchor) return;

    let frame = 0;
    const updatePosition = () => {
      frame = 0;
      const shell = viewMode === "continuous"
        ? continuousPageRefs.current.get(selectionAnchor.pageNumber)
        : pageShellRef.current;
      if (!shell) return;
      const bounds = shell.getBoundingClientRect();
      setSelectionAnchorPosition({
        left: bounds.left + selectionAnchor.x * bounds.width,
        top: bounds.top + selectionAnchor.y * bounds.height,
        side: selectionAnchor.side,
      });
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updatePosition);
    };
    const viewport = viewportRef.current;
    scheduleUpdate();
    viewport?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [selectionAnchor, viewMode, scale, rotation]);

  useEffect(() => {
    let cancelled = false; let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    void import("pdfjs-dist").then((pdfjs) => {
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      pdfjsRef.current = pdfjs;
      task = pdfjs.getDocument({ url: `/api/files/${attachmentId}`, disableAutoFetch: false, disableRange: false, disableStream: false });
      return task.promise;
    }).then((document) => { if (!cancelled && document) setPdf(document); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : pdfLoadFailedMessage); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [attachmentId, pdfLoadFailedMessage]);

  useEffect(() => {
    if (viewMode === "continuous" || !pdf || !pdfjsRef.current || !canvasRef.current || !textLayerRef.current || !pageShellRef.current) return;
    let cancelled = false; let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    setRendering(true); setSelection(null); setRegion(null);
    void pdf.getPage(pageNumber).then(async (pdfPage) => {
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale, rotation });
      const canvas = canvasRef.current!; const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas is unavailable");
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      const shell = pageShellRef.current!; shell.style.width = `${viewport.width}px`; shell.style.height = `${viewport.height}px`;
      shell.style.setProperty("--total-scale-factor", String(viewport.scale));
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      await renderTask.promise;
      if (cancelled) return;
      const layer = textLayerRef.current!; layer.replaceChildren();
      const textContent = await pdfPage.getTextContent();
      if (textContent.items.length) {
        await new pdfjsRef.current!.TextLayer({ textContentSource: textContent, container: layer, viewport }).render();
      } else if (currentPage?.extractionMethod === "ocr") {
        let words: Array<{ text: string; x: number; y: number; width: number; height: number }> = [];
        try { words = JSON.parse(currentPage.textLayerJson) as typeof words; } catch { /* ignore */ }
        for (const word of words) {
          const span = document.createElement("span"); span.textContent = word.text;
          Object.assign(span.style, { left: `${word.x * 100}%`, top: `${word.y * 100}%`, width: `${word.width * 100}%`, height: `${word.height * 100}%`, fontSize: `${Math.max(8, word.height * viewport.height)}px` });
          layer.appendChild(span);
        }
      }
      setRendering(false);
      }).catch((reason) => { if (!cancelled && !isPdfRenderCancellation(reason)) { setError(reason instanceof Error ? reason.message : pdfLoadFailedMessage); setRendering(false); } });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [currentPage?.extractionMethod, currentPage?.textLayerJson, pageNumber, pdf, pdfLoadFailedMessage, rotation, scale, viewMode]);


  useEffect(() => {
    if (!pdf || !pdfjsRef.current || viewMode !== "double" || !secondaryCanvasRef.current || !secondaryTextLayerRef.current || !secondaryPageShellRef.current || pageNumber >= pages.length) return;
    let cancelled = false; let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    void pdf.getPage(pageNumber + 1).then((pdfPage) => {
      if (cancelled || !secondaryCanvasRef.current || !secondaryTextLayerRef.current || !secondaryPageShellRef.current || !pdfjsRef.current) return;
      const viewport = pdfPage.getViewport({ scale, rotation });
      const canvas = secondaryCanvasRef.current; const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
      secondaryPageShellRef.current.style.width = viewport.width + "px"; secondaryPageShellRef.current.style.height = viewport.height + "px";
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      void renderTask.promise.then(async () => {
        if (cancelled || !secondaryTextLayerRef.current || !pdfjsRef.current) return;
        const textContent = await pdfPage.getTextContent();
        secondaryTextLayerRef.current.replaceChildren();
        await new pdfjsRef.current.TextLayer({ textContentSource: textContent, container: secondaryTextLayerRef.current, viewport }).render();
      }).catch((reason) => { if (!cancelled && !isPdfRenderCancellation(reason)) setError(reason instanceof Error ? reason.message : pdfLoadFailedMessage); });
    });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pageNumber, pages.length, pdf, pdfLoadFailedMessage, rotation, scale, viewMode]);

  useEffect(() => {
    const generation = ++continuousRenderGenerationRef.current;
    const renderTasks = continuousRenderTasksRef.current;
    const loadingPages = continuousLoadingPagesRef.current;
    const renderedPages = continuousRenderedPagesRef.current;
    return () => {
      if (continuousRenderGenerationRef.current !== generation) return;
      continuousRenderGenerationRef.current += 1;
      renderTasks.forEach((task) => task.cancel());
      renderTasks.clear();
      loadingPages.clear();
      renderedPages.clear();
    };
  }, [pdf, rotation, scale, viewMode]);

  useEffect(() => {
    if (!pdf || viewMode !== "continuous") return;
    const generation = continuousRenderGenerationRef.current;
    const desiredPages = new Set(continuousRenderPages);
    const activeSearchPage = searchOccurrences[activeSearchIndex]?.pageNumber;
    if (activeSearchPage) desiredPages.add(activeSearchPage);
    desiredPages.add(pageNumber);
    for (const page of pages) {
      const canvas = continuousCanvasRefs.current.get(page.pageNumber);
      if (!canvas) continue;
      const shell = continuousPageRefs.current.get(page.pageNumber);
      const rotated = rotation % 180 !== 0;
      const displayWidth = (rotated ? page.height : page.width) * scale;
      const displayHeight = (rotated ? page.width : page.height) * scale;
      canvas.style.width = displayWidth + "px";
      canvas.style.height = displayHeight + "px";
      if (shell) {
        shell.style.width = displayWidth + "px";
        shell.style.height = displayHeight + "px";
        shell.style.setProperty("--total-scale-factor", String(scale));
      }
    }
    for (const [renderedPage, task] of continuousRenderTasksRef.current) {
      if (!desiredPages.has(renderedPage)) {
        task.cancel();
        continuousRenderTasksRef.current.delete(renderedPage);
      }
    }
    for (const renderedPage of continuousRenderedPagesRef.current) {
      if (desiredPages.has(renderedPage)) continue;
      const canvas = continuousCanvasRefs.current.get(renderedPage);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      continuousTextLayerRefs.current.get(renderedPage)?.replaceChildren();
      continuousRenderedPagesRef.current.delete(renderedPage);
    }
    for (const page of pages) {
      if (!desiredPages.has(page.pageNumber) || continuousRenderedPagesRef.current.has(page.pageNumber) || continuousLoadingPagesRef.current.has(page.pageNumber)) continue;
      const canvas = continuousCanvasRefs.current.get(page.pageNumber);
      if (!canvas) continue;
      continuousLoadingPagesRef.current.add(page.pageNumber);
      void pdf.getPage(page.pageNumber).then((pdfPage) => {
        if (continuousRenderGenerationRef.current !== generation || (!desiredPages.has(page.pageNumber) && page.pageNumber !== continuousActivePageRef.current)) return;
        const viewport = pdfPage.getViewport({ scale, rotation });
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
        const shell = continuousPageRefs.current.get(page.pageNumber);
        if (shell) { shell.style.width = viewport.width + "px"; shell.style.height = viewport.height + "px"; shell.style.setProperty("--total-scale-factor", String(viewport.scale)); }
        const renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
        continuousRenderTasksRef.current.set(page.pageNumber, renderTask);
        return renderTask.promise.then(async () => {
          const layer = continuousTextLayerRefs.current.get(page.pageNumber);
          if (continuousRenderGenerationRef.current !== generation || !layer || !pdfjsRef.current) return;
          layer.replaceChildren();
          const textContent = await pdfPage.getTextContent();
          if (textContent.items.length) {
            await new pdfjsRef.current.TextLayer({ textContentSource: textContent, container: layer, viewport }).render();
          }
          if (continuousRenderGenerationRef.current === generation) continuousRenderedPagesRef.current.add(page.pageNumber);
        }).finally(() => { if (continuousRenderTasksRef.current.get(page.pageNumber) === renderTask) continuousRenderTasksRef.current.delete(page.pageNumber); });
      }).catch((reason) => { if (continuousRenderGenerationRef.current === generation && !isPdfRenderCancellation(reason)) setError(reason instanceof Error ? reason.message : pdfLoadFailedMessage); }).finally(() => { continuousLoadingPagesRef.current.delete(page.pageNumber); });
    }
  }, [activeSearchIndex, continuousRenderPages, pageNumber, pages, pdf, pdfLoadFailedMessage, rotation, scale, searchOccurrences, viewMode]);

  useEffect(() => {
    if (!pdf || outlineLoaded) return;
    const activePdf = pdf;
    let cancelled = false;
    void activePdf.getOutline().then(async (items) => {
      const flattened: Array<{ title: string; pageNumber?: number; depth: number }> = [];
      async function visit(entries: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>, depth: number) {
        for (const item of entries ?? []) {
          let page: number | undefined;
          try {
            const destination = typeof item.dest === "string" ? await activePdf.getDestination(item.dest) : item.dest;
            if (destination?.[0]) page = await activePdf.getPageIndex(destination[0]) + 1;
          } catch { /* malformed outline destinations stay visible without a page */ }
          flattened.push({ title: item.title || t("untitled"), pageNumber: page, depth });
          await visit(item.items, depth + 1);
        }
      }
      await visit(items, 0);
      if (!cancelled) { setOutline(flattened); setOutlineLoaded(true); }
    }).catch(() => { if (!cancelled) setOutlineLoaded(true); });
    return () => { cancelled = true; };
  }, [outlineLoaded, pdf, t]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!query.trim()) { setActiveSearchIndex(-1); return; }
      setActiveSearchIndex((value) => value >= 0 && value < searchOccurrences.length ? value : searchOccurrences.length ? 0 : -1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [query, searchOccurrences.length]);

  useEffect(() => {
    const needle = query.trim().toLocaleLowerCase();
    const activePage = searchOccurrences[activeSearchIndex]?.pageNumber;
    const layers = [textLayerRef.current, secondaryTextLayerRef.current, ...continuousTextLayerRefs.current.values()];
    layers.forEach((layer) => layer?.querySelectorAll("span").forEach((span) => {
      const matches = Boolean(needle && span.textContent?.toLocaleLowerCase().includes(needle));
      const layerPage = Number(layer.parentElement?.dataset.pageNumber) || pageNumber;
      span.toggleAttribute("data-search-match", matches);
      span.toggleAttribute("data-search-active", matches && layerPage === activePage);
    }));
  }, [activeSearchIndex, pageNumber, query, rendering, scale, searchOccurrences, viewMode]);
  useEffect(() => {
    if (viewMode !== "continuous" || !viewportRef.current) return;
    const viewport = viewportRef.current;
    let frame: number | null = null;
    const updateVisiblePage = () => {
      frame = null;
      const viewportBounds = viewport.getBoundingClientRect();
      const viewportCenter = viewportBounds.top + viewportBounds.height / 2;
      const measuredPages = [...continuousPageRefs.current.entries()]
        .map(([number, element]) => ({ number, bounds: element.getBoundingClientRect() }));
      const overscan = viewportBounds.height;
      const nextRenderPages = measuredPages
        .filter(({ bounds }) => bounds.bottom >= viewportBounds.top - overscan && bounds.top <= viewportBounds.bottom + overscan)
        .map(({ number }) => number);
      setContinuousRenderPages((current) => current.length === nextRenderPages.length && current.every((value, index) => value === nextRenderPages[index]) ? current : nextRenderPages);
      const visible = measuredPages
        .filter(({ bounds }) => bounds.bottom >= viewportBounds.top && bounds.top <= viewportBounds.bottom)
        .sort((a, b) => {
          const distance = (bounds: DOMRect) => Math.max(bounds.top - viewportCenter, 0, viewportCenter - bounds.bottom);
          return distance(a.bounds) - distance(b.bounds);
        })[0];
      const nextPage = visible?.number;
      if (restoreContinuousPage.current !== null) {
        if (nextPage !== restoreContinuousPage.current) return;
        restoreContinuousPage.current = null;
      }
      if (!nextPage || nextPage === pageNumber) return;
      setPageNumber(nextPage);
      router.replace("/wiki/sources/" + sourceId + "/read/" + documentId + "?page=" + nextPage, { scroll: false });
    };
    const scheduleVisiblePageUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateVisiblePage);
    };
    viewport.addEventListener("scroll", scheduleVisiblePageUpdate, { passive: true });
    scheduleVisiblePageUpdate();
    return () => {
      viewport.removeEventListener("scroll", scheduleVisiblePageUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [documentId, pageNumber, router, sourceId, viewMode]);

  useEffect(() => {
    if (viewMode !== "continuous") return;
    const targetPage = restoreContinuousPage.current;
    if (targetPage === null && !initialContinuousScroll.current) return;
    const pageToScrollTo = targetPage ?? pageNumber;
    const timer = window.setTimeout(() => {
      continuousPageRefs.current.get(pageToScrollTo)?.scrollIntoView({ behavior: "auto", block: "start" });
      restoreContinuousPage.current = null;
      initialContinuousScroll.current = false;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [pageNumber, viewMode]);

  function changeViewMode(nextMode: "continuous" | "single" | "double") {
    if (nextMode === "continuous" && viewMode !== "continuous") restoreContinuousPage.current = pageNumber;
    setViewMode(nextMode);
  }

  const pageAnnotations = annotations.filter((annotation) => annotation.pageNumber === pageNumber);

  function readerUrl(nextPage: number, annotationId?: string) {
    return `/wiki/sources/${sourceId}/read/${documentId}?page=${nextPage}${annotationId ? `&annotation=${annotationId}` : ""}`;
  }

  function updateUrl(nextPage: number) {
    setPageNumber(nextPage);
    if (commentPanel.mode === "thread") setCommentPanel({ mode: "list" });
    setActiveAnnotationId("");
    router.replace(readerUrl(nextPage), { scroll: false });
    if (viewMode === "continuous") scrollToPage(nextPage);
  }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        setShowThumbnails(true);
        setNavigatorTab("search");
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing) {
        if (event.key === "Escape" && event.target === searchInputRef.current) {
          event.preventDefault();
          if (query) setQuery(""); else setNavigatorTab("pages");
        }
        return;
      }
      if (event.key === "Escape") {
        setRegionMode(false); setRegion(null); setSelection(null); setSelectionAnchor(null);
      }
      const goToPage = (nextPage: number) => {
        setPageNumber(nextPage);
        setCommentPanel((panel) => panel.mode === "thread" ? { mode: "list" } : panel);
        setActiveAnnotationId("");
        router.replace(`/wiki/sources/${sourceId}/read/${documentId}?page=${nextPage}`, { scroll: false });
        if (viewMode === "continuous") window.setTimeout(() => continuousPageRefs.current.get(nextPage)?.scrollIntoView({ behavior: reducedMotion.current ? "auto" : "smooth", block: "start" }), 0);
      };
      if (event.key === "ArrowLeft" || event.key === "PageUp") goToPage(Math.max(1, pageNumber - 1));
      if (event.key === "ArrowRight" || event.key === "PageDown") goToPage(Math.min(pages.length, pageNumber + 1));
      if (event.key === "+" || event.key === "=") { setFitMode("custom"); setScale(Math.min(3, scale + 0.15)); }
      if (event.key === "-") { setFitMode("custom"); setScale(Math.max(0.5, scale - 0.15)); }
    }
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [documentId, pageNumber, pages.length, query, router, scale, sourceId, viewMode]);

  function captureSelection() {
    const browserSelection = window.getSelection();
    if (!browserSelection || browserSelection.isCollapsed || browserSelection.rangeCount === 0) { setSelection(null); setSelectionAnchor(null); return; }
    const selectedElement = browserSelection.getRangeAt(0).commonAncestorContainer.parentElement?.closest("[data-page-number]") as HTMLDivElement | null;
    const shell = selectedElement ?? pageShellRef.current;
    const selectedPageNumber = Number(selectedElement?.dataset.pageNumber) || pageNumber;
    if (selectedElement) setPageNumber(selectedPageNumber);
    if (!shell) { setSelection(null); setSelectionAnchor(null); return; }
    const text = browserSelection.toString().trim(); if (!text) { setSelection(null); setSelectionAnchor(null); return; }
    const bounds = shell.getBoundingClientRect();
    const clientRects = Array.from(browserSelection.getRangeAt(0).getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom >= bounds.top && rect.top <= bounds.bottom);
    const range = browserSelection.getRangeAt(0);
    const selectedBackwards = browserSelection.anchorNode === range.endContainer && browserSelection.anchorOffset === range.endOffset;
    const endpointRect = selectedBackwards ? clientRects[0] : clientRects.at(-1);
    const endpointSide = selectedBackwards ? "left" : "right";
    const rects = clientRects.map((rect) => ({
      x: Math.max(0, rect.left - bounds.left) / bounds.width,
      y: Math.max(0, rect.top - bounds.top) / bounds.height,
      width: Math.min(rect.width, bounds.right - Math.max(rect.left, bounds.left)) / bounds.width,
      height: Math.min(rect.height, bounds.bottom - Math.max(rect.top, bounds.top)) / bounds.height,
    })).filter((rect) => rect.width > 0 && rect.height > 0);
    setSelection(rects.length ? { text, rects, pageNumber: selectedPageNumber } : null);
    setSelectionAnchor(endpointRect ? {
      pageNumber: selectedPageNumber,
      x: ((endpointSide === "left" ? endpointRect.left : endpointRect.right) - bounds.left) / bounds.width,
      y: (endpointRect.bottom - bounds.top) / bounds.height,
      side: endpointSide,
    } : null);
  }

  function requestAnnotation(annotation: PendingAnnotation) {
    setAnnotationNote("");
    if (annotation.kind === "text" && selectionAnchorPosition) setAnnotationAnchor(selectionAnchorPosition);
    else if (annotation.kind === "region" && pageShellRef.current) {
      const bounds = pageShellRef.current.getBoundingClientRect();
      const rect = annotation.geometry[0];
      setAnnotationAnchor({ left: bounds.left + (rect.x + rect.width) * bounds.width, top: bounds.top + (rect.y + rect.height) * bounds.height });
    } else setAnnotationAnchor(null);
    setPendingAnnotation(annotation);
  }

  async function saveAnnotation(kind: "text" | "region" | "bookmark", geometry: PdfRect[], selectedText = "", previewDataUrl?: string, annotationPageNumber = pageNumber, note = "", extendExisting = false) {
    const overlappingHighlights = extendExisting ? findOverlappingHighlights(annotationPageNumber, geometry) : [];
    const existingHighlight = overlappingHighlights[0];
    if (existingHighlight) {
      await extendPdfAnnotation({ id: existingHighlight.id, geometry, selectedText });
      setAnnotations((items) => items.map((item) => item.id === existingHighlight.id ? { ...item, geometryJson: JSON.stringify(geometry), selectedText, updatedAt: new Date().toISOString() } : item));
      window.getSelection()?.removeAllRanges(); setSelection(null); setSelectionAnchor(null); setAnnotationAnchor(null); setRegion(null); setRegionMode(false);
      return;
    }
    const result = await createPdfAnnotation({ documentId, pageNumber: annotationPageNumber, kind, geometry, selectedText, note, previewDataUrl });
    const created: ReaderAnnotation = { id: result.id, pageNumber: annotationPageNumber, kind, selectedText, note, label: "", color: "yellow", geometryJson: JSON.stringify(geometry), hasPreview: Boolean(previewDataUrl), createdBy: user.id, createdByName: user.name, createdByMarkColor: user.markColor, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: [] };
    setAnnotations((items) => [...items, created]);
    toast(t("annotationCreated"), {
      action: {
        label: t("undo"),
        onClick: () => { void deletePdfAnnotation(created.id); setAnnotations((items) => items.filter((item) => item.id !== created.id)); },
      },
    });
    window.getSelection()?.removeAllRanges(); setSelection(null); setSelectionAnchor(null); setAnnotationAnchor(null); setRegion(null); setRegionMode(false);
  }

  function previewForRegion(rect: PdfRect) {
    const canvas = canvasRef.current; if (!canvas) return undefined;
    const crop = document.createElement("canvas"); crop.width = Math.max(1, Math.round(rect.width * canvas.width)); crop.height = Math.max(1, Math.round(rect.height * canvas.height));
    crop.getContext("2d")?.drawImage(canvas, rect.x * canvas.width, rect.y * canvas.height, rect.width * canvas.width, rect.height * canvas.height, 0, 0, crop.width, crop.height);
    return crop.toDataURL("image/png");
  }

  async function submitReply(annotationId: string) {
    const body = replyByAnnotation[annotationId]?.trim(); if (!body) return;
    const comment = await createPdfAnnotationComment({ annotationId, body });
    setAnnotations((items) => items.map((annotation) => annotation.id === annotationId ? { ...annotation, comments: [...annotation.comments, comment] } : annotation));
    setReplyByAnnotation((items) => ({ ...items, [annotationId]: "" }));
  }

  async function saveEditedReply(annotationId: string, commentId: string) {
    const body = commentDraftById[commentId]?.trim(); if (!body) return;
    const updated = await updatePdfAnnotationComment({ id: commentId, body });
    setAnnotations((items) => items.map((annotation) => annotation.id === annotationId ? {
      ...annotation,
      comments: annotation.comments.map((comment) => comment.id === commentId ? { ...comment, body: updated.body } : comment),
    } : annotation));
    setEditingCommentId(null);
    setCommentDraftById((items) => { const next = { ...items }; delete next[commentId]; return next; });
  }

  function beginEditingReply(comment: ReaderAnnotation["comments"][number]) {
    setCommentDraftById((items) => ({ ...items, [comment.id]: comment.body }));
    setEditingCommentId(comment.id);
  }

  function openAnnotation(annotation: ReaderAnnotation, navigateToPage = false, target?: HTMLElement) {
    setActiveAnnotationId(annotation.id);
    setCommentPanel({ mode: "thread", annotationId: annotation.id });
    const nextPage = navigateToPage ? annotation.pageNumber : pageNumber;
    if (navigateToPage) {
      setPageNumber(annotation.pageNumber);
      if (viewMode === "continuous") scrollToPage(annotation.pageNumber, "center");
    }
    router.replace(readerUrl(nextPage, annotation.id), { scroll: false });
    if (!target) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-annotation-marker="${CSS.escape(annotation.id)}"]`)?.scrollIntoView({ block: "center", behavior: reducedMotion.current ? "auto" : "smooth" }));
  }

  function showCommentList() {
    setCommentPanel({ mode: "list" });
    setActiveAnnotationId("");
    router.replace(readerUrl(pageNumber), { scroll: false });
  }

  function closeCommentPanel() {
    setCommentPanel({ mode: "closed" });
    setActiveAnnotationId("");
    router.replace(readerUrl(pageNumber), { scroll: false });
  }

  function annotationRects(annotation: ReaderAnnotation) {
    try { return JSON.parse(annotation.geometryJson) as PdfRect[]; } catch { return []; }
  }

  function displayAnnotationRects(annotation: ReaderAnnotation) {
    const rects = annotationRects(annotation).slice().sort((left, right) => left.y - right.y || left.x - right.x);
    return rects.map((rect, index) => {
      let top = rect.y;
      let bottom = rect.y + rect.height;
      const previous = rects[index - 1]; const next = rects[index + 1];
      if (previous && previous.y < rect.y && previous.y + previous.height > top) top = (previous.y + previous.height + top) / 2;
      if (next && rect.y < next.y && bottom > next.y) bottom = (bottom + next.y) / 2;
      return { ...rect, y: top, height: Math.max(0, bottom - top) };
    }).filter((rect) => rect.width > 0 && rect.height > 0);
  }

  function annotationMarker(annotation: ReaderAnnotation) {
    if (!annotation.note && annotation.comments.length === 0) return null;
    const rects = displayAnnotationRects(annotation);
    if (!rects.length && annotation.kind !== "bookmark") return null;
    const top = rects.length ? (Math.min(...rects.map((rect) => rect.y)) + Math.max(...rects.map((rect) => rect.y + rect.height))) / 2 : 0.035;
    const active = activeAnnotationId === annotation.id;
    return <button type="button" key={`${annotation.id}-marker`} data-annotation-marker={annotation.id} data-testid="pdf-annotation-marker" onClick={(event) => openAnnotation(annotation, false, event.currentTarget)} aria-label={`${t(`annotationKinds.${annotation.kind}`)} · ${annotation.createdByName}`} aria-pressed={active} className="pointer-events-auto absolute grid size-6 cursor-pointer place-items-center rounded-full border shadow-sm backdrop-blur-sm transition-[transform,box-shadow,background-color] motion-reduce:transition-none hover:scale-105 hover:shadow motion-reduce:hover:scale-100" style={{ ...userMarkColorStyle(annotation.createdByMarkColor), left: "calc(100% + 10px)", top: `${top * 100}%`, transform: "translateY(-50%)", borderColor: "var(--user-mark-solid)", backgroundColor: active ? "var(--user-mark-solid)" : "var(--background)", color: active ? "white" : "var(--user-mark-solid)", boxShadow: active ? "0 0 0 3px var(--user-mark-highlight)" : undefined }}>{annotation.kind === "bookmark" ? <Bookmark className="size-3.5" /> : <MessageCircle className="size-3.5" />}</button>;
  }

  function findOverlappingHighlights(targetPageNumber: number, geometry: PdfRect[]) {
    return annotations.filter((annotation) => annotation.pageNumber === targetPageNumber && (annotation.kind === "text" || annotation.kind === "region") && annotationRects(annotation).some((existingRect) => geometry.some((rect) =>
      Math.min(existingRect.x + existingRect.width, rect.x + rect.width) > Math.max(existingRect.x, rect.x) &&
      Math.min(existingRect.y + existingRect.height, rect.y + rect.height) > Math.max(existingRect.y, rect.y),
    )));
  }

  function regionPoint(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)), y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) };
  }

  async function applyFitMode(mode: FitMode) {
    setFitMode(mode);
    if (mode === "custom") return;
    if (!pdf || !viewportRef.current) return;
    const pdfPage = await pdf.getPage(pageNumber);
    const base = pdfPage.getViewport({ scale: 1, rotation });
    const nextScale = calculateFitScale({
      mode, pageWidth: base.width, pageHeight: base.height,
      viewportWidth: viewportRef.current.clientWidth, viewportHeight: viewportRef.current.clientHeight,
    });
    if (nextScale !== null) setScale(nextScale);
  }

  function setCustomScale(nextScale: number) {
    setFitMode("custom");
    setScale(Math.min(3, Math.max(0.5, nextScale)));
  }

  function navigateSearch(direction: 1 | -1) {
    if (!searchOccurrences.length) return;
    const next = activeSearchIndex < 0
      ? 0
      : (activeSearchIndex + direction + searchOccurrences.length) % searchOccurrences.length;
    const occurrence = searchOccurrences[next];
    setActiveSearchIndex(next);
    setLiveMessage(t("searchResultStatus", { current: next + 1, total: searchOccurrences.length, page: occurrence.pageNumber }));
    updateUrl(occurrence.pageNumber);
  }

  function scrollToPage(targetPage: number, block: ScrollLogicalPosition = "start") {
    window.setTimeout(() => continuousPageRefs.current.get(targetPage)?.scrollIntoView({
      behavior: reducedMotion.current ? "auto" : "smooth", block,
    }), 0);
  }

  const handleViewportWheel = useCallback((event: WheelEvent) => {
    const activeAnchor = zoomAnchorRef.current;
    if (!event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (zoomGestureTimeoutRef.current !== null) window.clearTimeout(zoomGestureTimeoutRef.current);
    zoomGestureTimeoutRef.current = window.setTimeout(() => {
      zoomAnchorRef.current = null;
      zoomGestureTimeoutRef.current = null;
    }, 500);
    const viewport = viewportRef.current;
    const content = zoomContentRef.current;
    if (!viewport || !content) return;
    const bounds = viewport.getBoundingClientRect();
    const eventElement = event.target instanceof Element ? event.target : null;
    const shell = (eventElement?.closest("[data-page-number]") as HTMLDivElement | null) ?? pageShellRef.current;
    const shellBounds = shell?.getBoundingClientRect();
    const anchor = activeAnchor ?? {
      cursorX: event.clientX - bounds.left,
      cursorY: event.clientY - bounds.top,
      shell,
      x: shellBounds ? (event.clientX - shellBounds.left) / shellBounds.width : 0.5,
      y: shellBounds ? (event.clientY - shellBounds.top) / shellBounds.height : 0.5,
    };
    zoomAnchorRef.current = anchor;
    const deltaY = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? event.deltaY * bounds.height : event.deltaY;
    const pending = pendingZoomRef.current;
    pendingZoomRef.current = {
      deltaY: (pending?.deltaY ?? 0) + deltaY,
      cursorX: anchor.cursorX,
      cursorY: anchor.cursorY,
      viewport,
    };
    if (zoomFrameRef.current !== null) return;
    zoomFrameRef.current = window.requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      const nextPending = pendingZoomRef.current;
      pendingZoomRef.current = null;
      if (!nextPending) return;
      const previousVisualScale = zoomScaleRef.current;
      const nextScale = Math.min(3, Math.max(0.5, previousVisualScale * Math.exp(-nextPending.deltaY * 0.0035)));
      if (Math.abs(nextScale - previousVisualScale) < 0.001) return;
      const contentX = nextPending.viewport.scrollLeft + nextPending.cursorX;
      const contentY = nextPending.viewport.scrollTop + nextPending.cursorY;
      zoomScaleRef.current = nextScale;
      content.style.setProperty("zoom", String(nextScale / scaleRef.current));
      if (zoomLabelRef.current) zoomLabelRef.current.textContent = Math.round(nextScale * 100) + "%";
      if (anchor.shell?.isConnected) {
        const viewportBounds = nextPending.viewport.getBoundingClientRect();
        const anchorBounds = anchor.shell.getBoundingClientRect();
        nextPending.viewport.scrollLeft += anchorBounds.left + anchor.x * anchorBounds.width - (viewportBounds.left + anchor.cursorX);
        nextPending.viewport.scrollTop += anchorBounds.top + anchor.y * anchorBounds.height - (viewportBounds.top + anchor.cursorY);
      } else {
        const ratio = nextScale / previousVisualScale;
        nextPending.viewport.scrollLeft = contentX * ratio - nextPending.cursorX;
        nextPending.viewport.scrollTop = contentY * ratio - nextPending.cursorY;
      }
      if (zoomCommitTimeoutRef.current !== null) window.clearTimeout(zoomCommitTimeoutRef.current);
      zoomCommitTimeoutRef.current = window.setTimeout(() => {
        zoomCommitTimeoutRef.current = null;
        const finalScale = zoomScaleRef.current;
        if (Math.abs(finalScale - scaleRef.current) < 0.001) {
          content.style.removeProperty("zoom");
          return;
        }
        zoomCommitPendingRef.current = true;
        setFitMode("custom");
        setScale(finalScale);
      }, 120);
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handleViewportWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleViewportWheel);
  }, [handleViewportWheel]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || fitMode === "custom") return;
    let frame: number | null = null;
    const recalculate = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!pdf || !viewportRef.current) return;
        void pdf.getPage(pageNumber).then((pdfPage) => {
          if (!viewportRef.current) return;
          const base = pdfPage.getViewport({ scale: 1, rotation });
          const nextScale = calculateFitScale({
            mode: fitMode, pageWidth: base.width, pageHeight: base.height,
            viewportWidth: viewportRef.current.clientWidth, viewportHeight: viewportRef.current.clientHeight,
          });
          if (nextScale !== null) setScale(nextScale);
        });
      });
    };
    const observer = new ResizeObserver(recalculate);
    observer.observe(viewport);
    recalculate();
    return () => { observer.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame); };
  }, [fitMode, pageNumber, pdf, rotation]);

  function selectionActionsStyle(anchor: { left: number; top: number; side: "left" | "right" }) {
    const width = 210; const height = 42; const gap = 8;
    const left = anchor.side === "right" ? anchor.left + gap : anchor.left - width - gap;
    const placeAbove = anchor.top - gap - height >= 16;
    const top = placeAbove ? anchor.top - gap : anchor.top + gap;
    return { left, top, transform: placeAbove ? "translateY(-100%)" : "translateY(0)" };
  }

  function annotationPopupStyle(anchor: { left: number; top: number }) {
    const width = 384; const height = 260; const gap = 24;
    const placeRight = anchor.left + gap + width <= window.innerWidth - 16;
    const left = placeRight ? anchor.left + gap : Math.max(16, anchor.left - width - gap);
    const placeAbove = anchor.top - gap - height >= 16;
    const top = placeAbove ? anchor.top - gap : Math.min(window.innerHeight - 16, anchor.top + gap);
    return { left, top, transform: placeAbove ? "translateY(-100%)" : "translateY(0)" };
  }

  function submitPendingAnnotation() {
    if (!pendingAnnotation) return;
    void saveAnnotation(pendingAnnotation.kind, pendingAnnotation.geometry, pendingAnnotation.selectedText, pendingAnnotation.previewDataUrl, pendingAnnotation.pageNumber, annotationNote).then(() => setPendingAnnotation(null));
  }

  function beginThumbnailResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    thumbnailResizeRef.current = { startX: event.clientX, startWidth: thumbnailWidth };
  }

  function beginCommentPanelResize(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    commentPanelResizeRef.current = { startX: event.clientX, startWidth: commentPanelWidth };
  }

  function selectSearchOccurrence(index: number) {
    const occurrence = searchOccurrences[index];
    if (!occurrence) return;
    setActiveSearchIndex(index);
    setLiveMessage(t("searchResultStatus", { current: index + 1, total: searchOccurrences.length, page: occurrence.pageNumber }));
    updateUrl(occurrence.pageNumber);
  }

  const thumbnailTools = <div className="flex h-full min-h-0 flex-col">
    <div className="grid grid-cols-3 gap-1 border-b p-2" role="tablist" aria-label={t("documentNavigator")}>
      {([
        ["pages", Menu, t("pages")],
        ["search", Search, t("search")],
        ["outline", ListTree, t("outline")],
      ] as const).map(([tab, Icon, label]) => <button key={tab} type="button" role="tab" aria-selected={navigatorTab === tab} title={label} className={`grid h-8 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${navigatorTab === tab ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300" : "text-muted-foreground hover:bg-muted"}`} onClick={() => setNavigatorTab(tab)}><Icon className="size-4" /><span className="sr-only">{label}</span></button>)}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {navigatorTab === "pages" && <div className="space-y-2">{pages.map((page) => <button key={page.pageNumber} className={`w-full rounded border p-1 ${page.pageNumber === pageNumber ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "bg-muted/20"}`} onClick={() => updateUrl(page.pageNumber)}><img src={"/api/wiki/pdf-documents/" + documentId + "/pages/" + page.pageNumber + "/thumbnail"} alt={t("pageNumber", { page: page.pageNumber })} className="mx-auto h-auto max-h-36 w-full object-contain" loading="lazy" /><span className="mt-1 block text-[10px]">{page.pageNumber}</span></button>)}</div>}
      {navigatorTab === "search" && <div>
        <div className="relative"><Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" /><Input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); navigateSearch(event.shiftKey ? -1 : 1); } }} className="h-8 pl-7 pr-7 text-xs" placeholder={t("searchInPdf")} />{query && <button type="button" aria-label={t("clearSearch")} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground" onClick={() => setQuery("")}><X className="size-4" /></button>}</div>
        <div className="my-2 flex items-center justify-between gap-1 text-[10px] text-muted-foreground"><span>{query ? t("searchMatches", { count: searchOccurrences.length }) : t("searchHint")}</span><span className="flex"><Button type="button" variant="ghost" size="icon-xs" disabled={!searchOccurrences.length} aria-label={t("previousMatch")} onClick={() => navigateSearch(-1)}><ChevronLeft /></Button><Button type="button" variant="ghost" size="icon-xs" disabled={!searchOccurrences.length} aria-label={t("nextMatch")} onClick={() => navigateSearch(1)}><ChevronRight /></Button></span></div>
        <div className="space-y-1">{searchOccurrences.map((occurrence, index) => <button key={occurrence.id} type="button" className={`block w-full rounded border p-2 text-left text-xs ${index === activeSearchIndex ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "hover:bg-accent"}`} onClick={() => selectSearchOccurrence(index)}><strong>{t("pageNumber", { page: occurrence.pageNumber })}</strong><span className="mt-1 line-clamp-3 block text-muted-foreground">{occurrence.snippet}</span></button>)}</div>
      </div>}
      {navigatorTab === "outline" && <div className="space-y-0.5">{!outlineLoaded && <p className="p-3 text-xs text-muted-foreground">{t("loading")}</p>}{outlineLoaded && !outline.length && <p className="p-3 text-xs text-muted-foreground">{t("noOutline")}</p>}{outline.map((item, index) => <button type="button" key={`${item.title}-${index}`} disabled={!item.pageNumber} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent disabled:cursor-default disabled:opacity-60" style={{ paddingLeft: `${8 + Math.min(item.depth, 5) * 12}px` }} onClick={() => item.pageNumber && updateUrl(item.pageNumber)}><span className="line-clamp-2">{item.title}</span>{item.pageNumber && <span className="text-[10px] text-muted-foreground">{t("pageNumber", { page: item.pageNumber })}</span>}</button>)}</div>}
    </div>
  </div>;

  const commentThreads = annotations;
  const normalizedCommentSearch = commentSearch.trim().toLocaleLowerCase();
  const filteredCommentThreads = commentThreads.filter((annotation) => {
    if (currentPageCommentsOnly && annotation.pageNumber !== pageNumber) return false;
    if (annotationKindFilter !== "all" && annotation.kind !== annotationKindFilter) return false;
    if (annotationColorFilter !== "all" && annotation.createdByMarkColor !== annotationColorFilter) return false;
    if (annotationAuthorFilter !== "all" && annotation.createdBy !== annotationAuthorFilter) return false;
    return !normalizedCommentSearch || [annotation.label, annotation.selectedText, annotation.note, annotation.createdByName, ...annotation.comments.flatMap((comment) => [comment.body, comment.createdByName])]
      .some((value) => value.toLocaleLowerCase().includes(normalizedCommentSearch));
  });
  const selectedAnnotation = commentPanel.mode === "thread" ? annotations.find((annotation) => annotation.id === commentPanel.annotationId) : undefined;
  const annotationAuthors = [...new Map(annotations.map((annotation) => [annotation.createdBy, annotation.createdByName])).entries()];

  function moveAnnotation(direction: 1 | -1) {
    if (!selectedAnnotation || !filteredCommentThreads.length) return;
    const index = filteredCommentThreads.findIndex((annotation) => annotation.id === selectedAnnotation.id);
    const next = filteredCommentThreads[(Math.max(0, index) + direction + filteredCommentThreads.length) % filteredCommentThreads.length];
    if (next) openAnnotation(next, true);
  }

  async function copyAnnotationCitation(annotation: ReaderAnnotation) {
    await navigator.clipboard.writeText(formatPdfCitation(sourceTitle, annotation.pageNumber, annotation.selectedText || annotation.note));
    toast.success(t("citationCopied"));
  }

  function beginEditingAnnotation(annotation: ReaderAnnotation) {
    setAnnotationEditDraft({ label: annotation.label, note: annotation.note });
    setEditingAnnotation(true);
  }

  async function saveAnnotationEdits(annotation: ReaderAnnotation) {
    await updatePdfAnnotation({ id: annotation.id, ...annotationEditDraft });
    setAnnotations((items) => items.map((item) => item.id === annotation.id ? { ...item, ...annotationEditDraft, updatedAt: new Date().toISOString() } : item));
    setEditingAnnotation(false);
    toast.success(t("annotationUpdated"));
  }

  async function removeAnnotation(annotation: ReaderAnnotation) {
    await deletePdfAnnotation(annotation.id);
    setAnnotations((items) => items.filter((item) => item.id !== annotation.id));
    showCommentList();
    toast(t("annotationDeleted"), {
      action: {
        label: t("undo"),
        onClick: () => { void restorePdfAnnotation(annotation.id); setAnnotations((items) => [...items, annotation].sort((left, right) => left.pageNumber - right.pageNumber)); },
      },
    });
  }

  function renderCommentPanel() {
    if (commentPanel.mode === "thread" && selectedAnnotation) return <div data-testid="pdf-annotation-thread" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 border-b p-2"><Button type="button" variant="ghost" size="icon-sm" aria-label={t("backToComments")} onClick={showCommentList}><ArrowLeft className="size-4" /></Button><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{selectedAnnotation.label || t(`annotationKinds.${selectedAnnotation.kind}`)}</p><p className="text-[11px] text-muted-foreground">{t("pageNumber", { page: selectedAnnotation.pageNumber })}</p></div><Button type="button" variant="ghost" size="icon-xs" aria-label={t("previousAnnotation")} onClick={() => moveAnnotation(-1)}><ChevronLeft /></Button><Button type="button" variant="ghost" size="icon-xs" aria-label={t("nextAnnotation")} onClick={() => moveAnnotation(1)}><ChevronRight /></Button><Button type="button" variant="ghost" size="icon-sm" aria-label={t("cancel")} onClick={closeCommentPanel}><X className="size-4" /></Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <button type="button" className="mb-3 w-full rounded-lg border bg-muted/30 p-2 text-left text-xs hover:bg-muted/60" onClick={() => openAnnotation(selectedAnnotation, true)}><span className="font-medium">{t("pageNumber", { page: selectedAnnotation.pageNumber })}</span><span className="mt-1 line-clamp-3 block text-muted-foreground">{selectedAnnotation.selectedText || selectedAnnotation.label || t(`annotationKinds.${selectedAnnotation.kind}`)}</span></button>
        {editingAnnotation ? <div className="space-y-2 rounded-lg border p-2.5"><Input value={annotationEditDraft.label} onChange={(event) => setAnnotationEditDraft((value) => ({ ...value, label: event.target.value }))} placeholder={t("annotationLabel")} /><Textarea value={annotationEditDraft.note} onChange={(event) => setAnnotationEditDraft((value) => ({ ...value, note: event.target.value }))} placeholder={t("note")} /><div className="flex justify-end gap-1"><Button size="xs" variant="ghost" onClick={() => setEditingAnnotation(false)}>{t("cancel")}</Button><Button size="xs" onClick={() => void saveAnnotationEdits(selectedAnnotation)}>{t("saveAnnotation")}</Button></div></div> : selectedAnnotation.note && <div className="rounded-lg border p-2.5" style={{ ...userMarkColorStyle(selectedAnnotation.createdByMarkColor), borderColor: "var(--user-mark-solid)" }}><NoteMeta name={selectedAnnotation.createdByName} markColor={selectedAnnotation.createdByMarkColor} timestamp={format.dateTime(new Date(selectedAnnotation.createdAt), { dateStyle: "medium", timeStyle: "short" })} /><p className="mt-1 whitespace-pre-wrap text-[13px] leading-5">{selectedAnnotation.note}</p></div>}
        {selectedAnnotation.comments.length > 0 && <div className="mt-3 space-y-2">{selectedAnnotation.comments.map((comment) => {
          const editing = editingCommentId === comment.id; const canEdit = comment.createdBy === user.id || user.role === "admin";
          return <div key={comment.id} className="group rounded-lg border p-2.5" style={{ ...userMarkColorStyle(comment.createdByMarkColor), borderLeftColor: "var(--user-mark-solid)", borderLeftWidth: 2 }}><NoteMeta name={comment.createdByName} markColor={comment.createdByMarkColor} timestamp={format.dateTime(new Date(comment.createdAt), { dateStyle: "medium", timeStyle: "short" })} />{editing ? <div className="relative mt-1"><Textarea autoFocus rows={1} className="max-h-28 min-h-9 resize-none rounded-lg border-border/70 bg-transparent py-1.5 pr-8 text-[13px] shadow-none focus-visible:ring-1" value={commentDraftById[comment.id] ?? ""} onChange={(event) => setCommentDraftById((items) => ({ ...items, [comment.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveEditedReply(selectedAnnotation.id, comment.id); } if (event.key === "Escape") { event.preventDefault(); setEditingCommentId(null); } }} /><Button type="button" variant="ghost" size="icon-xs" aria-label={t("sendReply")} className="absolute bottom-1 right-1 rounded-full" disabled={!commentDraftById[comment.id]?.trim()} onClick={() => void saveEditedReply(selectedAnnotation.id, comment.id)}><ArrowUp className="size-3.5" /></Button></div> : <div className="mt-1 flex items-end gap-1.5"><p className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-5 text-foreground/85">{comment.body}</p>{canEdit && <Button type="button" variant="ghost" size="icon-xs" aria-label={t("editReply")} className="shrink-0 rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => beginEditingReply(comment)}><Pencil className="size-3" /></Button>}</div>}</div>;
        })}</div>}
      </div>
      <div className="shrink-0 border-t p-2.5"><div className="relative"><Textarea data-testid="pdf-annotation-reply" rows={1} className="max-h-28 min-h-10 w-full resize-none rounded-xl border-border/70 bg-muted/20 px-3 py-2 pr-10 text-sm shadow-none transition-[background-color,border-color] focus-visible:bg-background focus-visible:ring-1" value={replyByAnnotation[selectedAnnotation.id] ?? ""} onChange={(event) => setReplyByAnnotation((items) => ({ ...items, [selectedAnnotation.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submitReply(selectedAnnotation.id); } }} placeholder={t("replyToAnnotation")} /><Button type="button" variant="ghost" size="icon-sm" aria-label={t("sendReply")} className="absolute bottom-1 right-1 rounded-full text-muted-foreground enabled:text-foreground enabled:hover:bg-foreground/5" disabled={!replyByAnnotation[selectedAnnotation.id]?.trim()} onClick={() => void submitReply(selectedAnnotation.id)}><ArrowUp className="size-4" /></Button></div><div className="mt-1 flex flex-wrap gap-1"><Button type="button" size="xs" variant="ghost" onClick={() => void copyAnnotationCitation(selectedAnnotation)}><Copy />{t("copyCitation")}</Button>{(selectedAnnotation.createdBy === user.id || user.role === "admin") && <><Button type="button" size="xs" variant="ghost" onClick={() => beginEditingAnnotation(selectedAnnotation)}><Pencil />{t("edit")}</Button><Button type="button" size="xs" variant="ghost" onClick={() => void removeAnnotation(selectedAnnotation)}><Trash2 />{t("delete")}</Button></>}</div></div>
    </div>;

    return <div data-testid="pdf-comment-list" className="flex h-full min-h-0 flex-col"><header className="flex items-center gap-2 border-b p-3"><MessageCircle className="size-4 text-indigo-600" /><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("comments")}</h2><span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{commentThreads.length}</span><Button type="button" variant="ghost" size="icon-sm" aria-label={t("cancel")} onClick={closeCommentPanel}><X className="size-4" /></Button></header><div className="space-y-2 border-b p-2"><div className="relative"><Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" /><Input value={commentSearch} onChange={(event) => setCommentSearch(event.target.value)} className="h-8 pl-7 text-xs" placeholder={t("searchComments")} /></div><div className="grid grid-cols-3 gap-1"><select aria-label={t("filterKind")} value={annotationKindFilter} onChange={(event) => setAnnotationKindFilter(event.target.value)} className="h-7 min-w-0 rounded border bg-background px-1 text-[10px]"><option value="all">{t("allKinds")}</option>{(["text", "region", "bookmark"] as const).map((kind) => <option key={kind} value={kind}>{t(`annotationKinds.${kind}`)}</option>)}</select><select aria-label={t("filterColor")} value={annotationColorFilter} onChange={(event) => setAnnotationColorFilter(event.target.value)} className="h-7 min-w-0 rounded border bg-background px-1 text-[10px]"><option value="all">{t("allColors")}</option>{USER_MARK_COLORS.map((item) => <option key={item.key} value={item.key}>{tMarkColor(item.key)}</option>)}</select><select aria-label={t("filterAuthor")} value={annotationAuthorFilter} onChange={(event) => setAnnotationAuthorFilter(event.target.value)} className="h-7 min-w-0 rounded border bg-background px-1 text-[10px]"><option value="all">{t("allAuthors")}</option>{annotationAuthors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><Button type="button" size="xs" variant={currentPageCommentsOnly ? "secondary" : "ghost"} onClick={() => setCurrentPageCommentsOnly((value) => !value)}>{currentPageCommentsOnly ? t("currentPageComments") : t("allComments")}</Button></div><div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">{filteredCommentThreads.map((annotation) => <button type="button" key={annotation.id} className="w-full rounded-lg border p-2.5 text-left text-xs transition-colors hover:bg-accent" style={{ ...userMarkColorStyle(annotation.createdByMarkColor), borderColor: activeAnnotationId === annotation.id ? "var(--user-mark-solid)" : undefined, backgroundColor: activeAnnotationId === annotation.id ? "var(--user-mark-highlight)" : undefined }} onClick={() => openAnnotation(annotation, true)}><span className="flex items-center justify-between gap-2 font-medium"><span className="truncate">{annotation.label || t(`annotationKinds.${annotation.kind}`)}</span><span className="shrink-0 text-[10px] text-muted-foreground">{t("pageNumber", { page: annotation.pageNumber })}</span></span><span className="mt-1 line-clamp-2 block text-muted-foreground">{annotation.note || annotation.selectedText || t(`annotationKinds.${annotation.kind}`)}</span><span className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground"><span className="truncate" style={{ color: "var(--user-mark-solid)" }}>{annotation.createdByName}</span><span className="shrink-0">{annotation.comments.length} · <MessageCircle className="inline size-3" /></span></span></button>)}{filteredCommentThreads.length === 0 && <p className="p-4 text-center text-xs text-muted-foreground">{t("noMatchingComments")}</p>}</div></div>;
  }

  const thumbnailsVisible = showThumbnails && !isFocused;
  const commentsVisible = commentPanel.mode !== "closed";
  const gridColumns = thumbnailsVisible && commentsVisible
      ? styles.gridWithThumbnailsAndAnnotations
      : thumbnailsVisible
        ? styles.gridWithThumbnails
        : commentsVisible
          ? styles.gridWithAnnotations
          : styles.gridOnlyReader;


  if (error) return <div className="grid min-h-screen place-items-center p-8 text-center"><div><p className="text-destructive">{error}</p><Link className={buttonVariants({ className: "mt-3" })} href={"/wiki/sources/" + sourceId}>{t("backToSource")}</Link></div></div>;

  return <main className="flex h-dvh min-h-0 flex-col bg-transparent">
    <div className="sr-only" aria-live="polite" aria-atomic="true">{liveMessage}</div>
    <header data-testid="pdf-toolbar" className="flex h-12 shrink-0 flex-nowrap items-center gap-1 overflow-hidden border-b bg-background px-2 shadow-sm"><Link aria-label={t("backToSource")} title={t("backToSource")} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} href="/wiki/sources"><ArrowLeft className="size-4" /></Link><div className="hidden min-w-0 max-w-48 flex-1 lg:block"><p className="truncate text-xs font-medium">{sourceTitle}</p><p className="truncate text-[10px] text-muted-foreground">{fileName}</p></div>
      <div className="flex shrink-0 items-center rounded-lg border bg-muted/20"><Button aria-label={t("previousPage")} title={t("previousPage")} variant="ghost" size="icon-sm" disabled={pageNumber <= 1} onClick={() => updateUrl(pageNumber - 1)}><ChevronLeft className="size-4" /></Button><Input aria-label={t("page")} className="h-7 w-11 border-0 bg-transparent px-1 text-center text-xs shadow-none" inputMode="numeric" value={pageNumber} onChange={(event) => { const page = Number(event.target.value); if (Number.isInteger(page) && page >= 1 && page <= pages.length) updateUrl(page); }} /><span className="pr-1 text-[10px] text-muted-foreground">/ {pages.length}</span><Button aria-label={t("nextPage")} title={t("nextPage")} variant="ghost" size="icon-sm" disabled={pageNumber >= pages.length} onClick={() => updateUrl(pageNumber + 1)}><ChevronRight className="size-4" /></Button></div>
      <Button aria-label={t("zoomOut")} title={t("zoomOut")} variant="ghost" size="icon-sm" onClick={() => setCustomScale(scale - 0.15)}><Minus className="size-4" /></Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button ref={zoomLabelRef} variant="ghost" size="sm" className="min-w-14 px-1 text-xs tabular-nums" aria-label={t("zoomOptions")} />}>{Math.round(scale * 100)}%<ChevronDown className="size-3" /></DropdownMenuTrigger><DropdownMenuContent align="center" className="w-48"><div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">{t("zoomOptions")}</div><DropdownMenuItem onClick={() => void applyFitMode("width")}>{fitMode === "width" && <Check />}{t("fitWidth")}</DropdownMenuItem><DropdownMenuItem onClick={() => void applyFitMode("page")}>{fitMode === "page" && <Check />}{t("fitPage")}</DropdownMenuItem><DropdownMenuItem onClick={() => void applyFitMode("actual")}>{fitMode === "actual" && <Check />}{t("actualSize")}</DropdownMenuItem><DropdownMenuSeparator />{[75, 100, 125, 150, 200].map((percentage) => <DropdownMenuItem key={percentage} onClick={() => setCustomScale(percentage / 100)}>{Math.round(scale * 100) === percentage && fitMode === "custom" && <Check />}{percentage}%</DropdownMenuItem>)}<DropdownMenuSeparator /><div className="px-1.5 py-1"><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pdf-custom-zoom">{t("customZoom")}</label><Input id="pdf-custom-zoom" aria-label={t("customZoom")} className="h-7" type="number" min={50} max={300} defaultValue={Math.round(scale * 100)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") setCustomScale(Number(event.currentTarget.value) / 100); }} /></div></DropdownMenuContent></DropdownMenu>
      <Button data-testid="pdf-zoom-in" aria-label={t("zoomIn")} title={t("zoomIn")} variant="ghost" size="icon-sm" onClick={() => setCustomScale(scale + 0.15)}><Plus className="size-4" /></Button>
      <Button aria-label={t("captureRegion")} title={t("captureRegion")} variant={regionMode ? "secondary" : "ghost"} size="sm" className="shrink-0 px-2" onClick={() => { if (viewMode === "continuous") setViewMode("single"); setRegionMode((value) => !value); }}><SquareDashedMousePointer className="size-4" /><span className="hidden xl:inline">{t("captureRegion")}</span></Button>
      <Button aria-label={t("bookmarkPage")} title={t("bookmarkPage")} variant="ghost" size="icon-sm" onClick={() => requestAnnotation({ kind: "bookmark", geometry: [], selectedText: "", pageNumber })}><Bookmark className="size-4" /></Button>
      <Button className="relative" variant={commentsVisible ? "secondary" : "ghost"} size="icon-sm" aria-label={commentsVisible ? t("hideAnnotations") : t("showAnnotations")} aria-pressed={commentsVisible} title={commentsVisible ? t("hideAnnotations") : t("showAnnotations")} onClick={() => commentsVisible ? closeCommentPanel() : showCommentList()}><MessageCircle className="size-4" />{commentThreads.length > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-indigo-600 px-1 text-[9px] leading-4 text-white tabular-nums">{commentThreads.length}</span>}</Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("morePdfActions")} title={t("morePdfActions")} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">{t("viewMode")}</div><DropdownMenuItem onClick={() => changeViewMode("continuous")}>{viewMode === "continuous" && <Check />}{t("continuousView")}</DropdownMenuItem><DropdownMenuItem onClick={() => changeViewMode("single")}>{viewMode === "single" && <Check />}{t("singlePageView")}</DropdownMenuItem><DropdownMenuItem onClick={() => changeViewMode("double")}>{viewMode === "double" && <Check />}{t("doublePageView")}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw />{t("rotate")}</DropdownMenuItem><DropdownMenuItem onClick={() => setShowThumbnails((value) => !value)}><FileSearch />{showThumbnails ? t("hideNavigator") : t("showNavigator")}</DropdownMenuItem><DropdownMenuItem onClick={() => { setShowThumbnails(true); setNavigatorTab("outline"); }}><ListTree />{t("outline")}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem render={<a href={`/api/files/${attachmentId}?download=1`} download />}><Download />{t("download")}</DropdownMenuItem><DropdownMenuItem onClick={() => window.open(`/api/files/${attachmentId}`, "_blank", "noopener,noreferrer")}><ExternalLink />{t("openOriginal")}</DropdownMenuItem><DropdownMenuItem onClick={() => window.open(`/api/files/${attachmentId}#toolbar=1`, "_blank", "noopener,noreferrer")}><Printer />{t("printPdf")}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => toast(t("keyboardShortcutsDescription"), { duration: 8000 })}><Keyboard />{t("keyboardShortcuts")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <FocusModeToggle compact />
    </header>
    <div className={`relative grid min-h-0 flex-1 ${styles.readerGrid} ${gridColumns}`} style={{ "--pdf-thumbnail-width": `${thumbnailWidth}px`, "--pdf-comment-width": `${commentPanelWidth}px` } as React.CSSProperties}>
      {thumbnailsVisible && <><aside data-testid="pdf-thumbnails-panel" className="hidden min-h-0 overflow-hidden border-r bg-background md:block">{thumbnailTools}</aside><button type="button" aria-label={t("resizeThumbnails")} title={t("resizeThumbnails")} className="absolute inset-y-0 z-30 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none border-x border-transparent bg-background/50 transition-colors hover:border-indigo-300 hover:bg-indigo-500/15 focus-visible:border-indigo-500 focus-visible:bg-indigo-500/15 md:block" style={{ left: `${thumbnailWidth}px` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); beginThumbnailResize(event); }} /></>}
      <section ref={viewportRef} data-testid="pdf-reader-viewport" className="relative overflow-auto [overflow-anchor:none] p-4" onMouseUp={captureSelection}>{!pdf || (rendering && viewMode !== "continuous") ? <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center"><Loader2 className="size-7 animate-spin text-indigo-500" /></div> : null}{viewMode === "continuous" ? <div ref={zoomContentRef} className="space-y-4">{pages.map((page) => <div key={page.pageNumber} data-page-number={page.pageNumber} ref={(element) => { if (element) continuousPageRefs.current.set(page.pageNumber, element); else continuousPageRefs.current.delete(page.pageNumber); }} className={styles.pageShell}><canvas ref={(element) => { if (element) continuousCanvasRefs.current.set(page.pageNumber, element); else continuousCanvasRefs.current.delete(page.pageNumber); }} className="block" /><div ref={(element) => { if (element) continuousTextLayerRefs.current.set(page.pageNumber, element); else continuousTextLayerRefs.current.delete(page.pageNumber); }} className={styles.textLayer} /><div className="pointer-events-none absolute inset-0 z-[3]">{annotations.filter((annotation) => annotation.pageNumber === page.pageNumber).flatMap((annotation) => displayAnnotationRects(annotation).map((rect, index) => <div data-annotation-rect={annotation.id} key={annotation.id + "-" + index} className="absolute" style={{ ...userMarkColorStyle(annotation.createdByMarkColor), left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: "var(--user-mark-highlight)", borderBottom: annotation.kind === "region" ? "2px solid var(--user-mark-solid)" : undefined }} />))}{annotations.filter((annotation) => annotation.pageNumber === page.pageNumber).map(annotationMarker)}</div></div>)}</div> : <div ref={zoomContentRef} className="flex items-start justify-center gap-4"><div ref={pageShellRef} data-page-number={pageNumber} className={styles.pageShell}><canvas ref={canvasRef} className="block" /><div ref={textLayerRef} className={styles.textLayer} />
        <div className="pointer-events-none absolute inset-0 z-[3]">{pageAnnotations.flatMap((annotation) => displayAnnotationRects(annotation).map((rect, index) => <div data-annotation-rect={annotation.id} key={annotation.id + "-" + index} className="absolute" style={{ ...userMarkColorStyle(annotation.createdByMarkColor), left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: "var(--user-mark-highlight)", borderBottom: annotation.kind === "region" ? "2px solid var(--user-mark-solid)" : undefined }} />))}{pageAnnotations.map(annotationMarker)}{region && <div className="absolute border-2 bg-transparent" style={{ ...userMarkColorStyle(user.markColor), left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%`, borderColor: "var(--user-mark-solid)", backgroundColor: "var(--user-mark-highlight)" }} />}</div>
        {regionMode && <div data-testid="pdf-region-selector" className="absolute inset-0 z-[5] cursor-crosshair" onPointerDown={(event) => { regionStart.current = regionPoint(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!regionStart.current) return; const end = regionPoint(event); setRegion({ x: Math.min(regionStart.current.x, end.x), y: Math.min(regionStart.current.y, end.y), width: Math.abs(end.x - regionStart.current.x), height: Math.abs(end.y - regionStart.current.y) }); }} onPointerUp={(event) => { const start = regionStart.current; if (start) { const end = regionPoint(event); setRegion({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }); const bounds = event.currentTarget.getBoundingClientRect(); setSelectionAnchor({ pageNumber, x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, side: "right" }); } if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); regionStart.current = null; }} />}
      </div>{viewMode === "double" && pageNumber < pages.length && <div ref={secondaryPageShellRef} data-page-number={pageNumber + 1} className={styles.pageShell}><canvas ref={secondaryCanvasRef} className="block" /><div ref={secondaryTextLayerRef} className={styles.textLayer} /><div className="pointer-events-none absolute inset-0 z-[3]">{annotations.filter((annotation) => annotation.pageNumber === pageNumber + 1).flatMap((annotation) => displayAnnotationRects(annotation).map((rect, index) => <div data-annotation-rect={annotation.id} key={annotation.id + "-secondary-" + index} className="absolute" style={{ ...userMarkColorStyle(annotation.createdByMarkColor), left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: "var(--user-mark-highlight)", borderBottom: annotation.kind === "region" ? "2px solid var(--user-mark-solid)" : undefined }} />))}{annotations.filter((annotation) => annotation.pageNumber === pageNumber + 1).map(annotationMarker)}</div></div>}</div>}{selection && selectionAnchorPosition && <div data-testid="pdf-selection-actions" className="fixed z-40 flex gap-1 rounded-lg border bg-background p-1 shadow-xl" style={selectionActionsStyle(selectionAnchorPosition)}><Button size="sm" onClick={() => void saveAnnotation("text", selection.rects, selection.text, undefined, selection.pageNumber, "", true)}><Highlighter className="size-4" />{t("highlight")}</Button><Button size="sm" variant="outline" onClick={() => requestAnnotation({ kind: "text", geometry: selection.rects, selectedText: selection.text, pageNumber: selection.pageNumber })}><MessageCircle className="size-4" />{t("note")}</Button></div>}{region && selectionAnchorPosition && <div data-testid="pdf-selection-actions" className="fixed z-40 flex gap-1 rounded-lg border bg-background p-1 shadow-xl" style={selectionActionsStyle(selectionAnchorPosition)}><Button size="sm" onClick={() => void saveAnnotation("region", [region], "", previewForRegion(region), pageNumber, "", true)}><Highlighter className="size-4" />{t("highlight")}</Button><Button size="sm" variant="outline" onClick={() => requestAnnotation({ kind: "region", geometry: [region], selectedText: "", previewDataUrl: previewForRegion(region), pageNumber })}><MessageCircle className="size-4" />{t("note")}</Button><Button size="sm" variant="ghost" onClick={() => { setRegion(null); setSelectionAnchor(null); }}>{t("cancel")}</Button></div>}</section>
      {commentsVisible && <><button type="button" aria-label={t("resizeComments")} title={t("resizeComments")} className="absolute inset-y-0 right-[var(--pdf-comment-width)] z-30 hidden w-3 translate-x-1/2 cursor-col-resize touch-none border-x border-transparent bg-background/50 transition-colors hover:border-indigo-300 hover:bg-indigo-500/15 focus-visible:border-indigo-500 focus-visible:bg-indigo-500/15 md:block" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); beginCommentPanelResize(event); }} /><aside data-testid="pdf-comments-panel" className="hidden min-h-0 overflow-hidden border-l bg-background md:block">{renderCommentPanel()}</aside></>}
    </div>
    <Sheet open={compactViewport && commentsVisible} onOpenChange={(open) => { if (!open) closeCommentPanel(); }}>
      <SheetContent side="bottom" showCloseButton={false} className="max-h-[min(76dvh,36rem)] rounded-t-2xl p-0"><div data-testid="pdf-annotation-mobile-sheet" className="min-h-0 flex-1">{renderCommentPanel()}</div></SheetContent>
    </Sheet>
    <Dialog open={Boolean(pendingAnnotation)} onOpenChange={(open) => { if (!open) { setPendingAnnotation(null); setAnnotationAnchor(null); } }}><DialogContent style={annotationAnchor ? annotationPopupStyle(annotationAnchor) : undefined}><DialogHeader><DialogTitle>{t("annotationNotePrompt")}</DialogTitle></DialogHeader><Textarea autoFocus value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitPendingAnnotation(); } }} rows={4} /><DialogFooter><Button variant="outline" onClick={() => setPendingAnnotation(null)}>{t("cancel")}</Button><Button onClick={submitPendingAnnotation}>{t("saveAnnotation")}</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
