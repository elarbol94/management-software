/* eslint-disable @next/next/no-img-element -- Authenticated PDF thumbnails and annotation crops are served by private routes. */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft, ArrowUp, Bookmark, ChevronLeft, ChevronRight, Crop, Highlighter,
  Loader2, MessageCircle, Minus, PanelLeft, PanelRight, Pencil, Plus, RotateCw, Search, Trash2, X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FocusModeToggle, useFocusMode } from "@/components/focus-mode";
import { createPdfAnnotation, createPdfAnnotationComment, deletePdfAnnotation, extendPdfAnnotation, updatePdfAnnotationComment } from "../pdf-actions";
import { calculateAnnotationSpotlightTop, type PdfRect } from "../lib/pdf-evidence";
import styles from "./pdf-reader.module.css";

type ReaderPage = {
  pageNumber: number; width: number; height: number; text: string;
  textLayerJson: string; extractionMethod: "native" | "ocr" | "empty"; hasThumbnail: boolean;
};
type ReaderAnnotation = {
  id: string; pageNumber: number; kind: "text" | "region" | "bookmark";
  selectedText: string; note: string; label: string; color: string; geometryJson: string;
  hasPreview: boolean; createdBy: string; createdByName: string; createdAt: string; updatedAt: string;
  comments: Array<{ id: string; body: string; createdBy: string; createdByName: string; createdAt: string }>;
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
type AnnotationSpotlight = { annotationId: string };

function isPdfRenderCancellation(reason: unknown) {
  return reason instanceof Error && reason.name === "RenderingCancelledException";
}

const COLORS: Record<string, string> = {
  yellow: "rgb(250 204 21 / 0.34)", green: "rgb(34 197 94 / 0.28)",
  blue: "rgb(59 130 246 / 0.28)", pink: "rgb(236 72 153 / 0.28)", purple: "rgb(168 85 247 / 0.28)",
};

export function PdfReader({
  sourceId, sourceTitle, attachmentId, documentId, fileName, pages, initialAnnotations,
  initialPage, initialAnnotationId, user,
}: {
  sourceId: string; sourceTitle: string; attachmentId: string; documentId: string; fileName: string;
  pages: ReaderPage[]; initialAnnotations: ReaderAnnotation[]; initialPage: number; initialAnnotationId?: string;
  user: { id: string; name: string; role?: string | null };
}) {
  const t = useTranslations("wiki"); const router = useRouter();
  const pdfLoadFailedMessage = t("pdfLoadFailed");
  const { isFocused } = useFocusMode();
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<"thumbnails" | "annotations" | "spotlight" | null>(null);
  const previousFocused = useRef(isFocused);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const pdfjsRef = useRef<typeof import("pdfjs-dist") | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.min(Math.max(initialPage, 1), Math.max(1, pages.length)));
  const [scale, setScale] = useState(1.25); const [rotation, setRotation] = useState(0);
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
  const [annotations, setAnnotations] = useState(initialAnnotations); const [color, setColor] = useState("yellow");
  const [activeAnnotationId, setActiveAnnotationId] = useState(initialAnnotationId ?? "");
  const [annotationSpotlight, setAnnotationSpotlight] = useState<AnnotationSpotlight | null>(null);
  const [spotlightTop, setSpotlightTop] = useState(12);
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
  const canvasRef = useRef<HTMLCanvasElement>(null); const textLayerRef = useRef<HTMLDivElement>(null);
  const pageShellRef = useRef<HTMLDivElement>(null); const annotationCardRefs = useRef(new Map<string, HTMLElement>()); const spotlightCloseRef = useRef<HTMLButtonElement>(null); const spotlightAsideRef = useRef<HTMLElement>(null); const spotlightPanelRef = useRef<HTMLElement>(null); const spotlightPositionFrameRef = useRef<number | null>(null); const secondaryPageShellRef = useRef<HTMLDivElement>(null); const secondaryCanvasRef = useRef<HTMLCanvasElement>(null); const continuousCanvasRefs = useRef(new Map<number, HTMLCanvasElement>()); const continuousTextLayerRefs = useRef(new Map<number, HTMLDivElement>()); const continuousPageRefs = useRef(new Map<number, HTMLDivElement>()); const viewportRef = useRef<HTMLDivElement>(null);
  const currentPage = pages.find((page) => page.pageNumber === pageNumber);

  const updateSpotlightPosition = useCallback(() => {
    const activeId = annotationSpotlight?.annotationId;
    const aside = spotlightAsideRef.current;
    const panel = spotlightPanelRef.current;
    if (!activeId || !aside || !panel) return;
    const marker = document.querySelector<HTMLElement>(`[data-annotation-marker="${CSS.escape(activeId)}"]`);
    if (!marker) return;
    const markerBounds = marker.getBoundingClientRect();
    const asideBounds = aside.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const nextTop = calculateAnnotationSpotlightTop({
      anchorTop: markerBounds.top,
      containerTop: asideBounds.top,
      containerHeight: asideBounds.height,
      panelHeight: panelBounds.height,
    });
    setSpotlightTop((current) => Math.abs(current - nextTop) < 0.5 ? current : nextTop);
  }, [annotationSpotlight]);

  const scheduleSpotlightPosition = useCallback(() => {
    if (spotlightPositionFrameRef.current !== null) return;
    spotlightPositionFrameRef.current = window.requestAnimationFrame(() => {
      spotlightPositionFrameRef.current = null;
      updateSpotlightPosition();
    });
  }, [updateSpotlightPosition]);

  const closeAnnotationSpotlight = useCallback(() => {
    setAnnotationSpotlight(null);
    setMobilePanel((current) => current === "spotlight" ? null : current);
  }, []);

  useEffect(() => {
    if (previousFocused.current === isFocused) return;
    previousFocused.current = isFocused;
    setShowThumbnails(!isFocused);
    setShowAnnotations(!isFocused);
    setMobilePanel(null);
  }, [isFocused]);

  useEffect(() => {
    if (!annotationSpotlight) return;
    spotlightCloseRef.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAnnotationSpotlight();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [annotationSpotlight, closeAnnotationSpotlight]);

  useEffect(() => {
    if (!annotationSpotlight) return;
    const viewport = viewportRef.current;
    const media = window.matchMedia("(min-width: 768px)");
    const handleBreakpointChange = () => setMobilePanel((current) => media.matches ? (current === "spotlight" ? null : current) : "spotlight");
    const resizeObserver = new ResizeObserver(scheduleSpotlightPosition);
    for (const element of [viewport, zoomContentRef.current, spotlightAsideRef.current, spotlightPanelRef.current]) {
      if (element) resizeObserver.observe(element);
    }
    viewport?.addEventListener("scroll", scheduleSpotlightPosition, { passive: true });
    window.addEventListener("resize", scheduleSpotlightPosition);
    media.addEventListener("change", handleBreakpointChange);
    scheduleSpotlightPosition();
    return () => {
      resizeObserver.disconnect();
      viewport?.removeEventListener("scroll", scheduleSpotlightPosition);
      window.removeEventListener("resize", scheduleSpotlightPosition);
      media.removeEventListener("change", handleBreakpointChange);
    };
  }, [annotationSpotlight, scheduleSpotlightPosition]);

  useEffect(() => {
    if (annotationSpotlight) scheduleSpotlightPosition();
  }, [annotationSpotlight, isFocused, rotation, scale, scheduleSpotlightPosition, viewMode]);

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
    if (spotlightPositionFrameRef.current !== null) window.cancelAnimationFrame(spotlightPositionFrameRef.current);
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
    function keyboard(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") setPageNumber((value) => Math.max(1, value - 1));
      if (event.key === "ArrowRight" || event.key === "PageDown") setPageNumber((value) => Math.min(pages.length, value + 1));
      if (event.key === "+" || event.key === "=") setScale((value) => Math.min(3, value + 0.15));
      if (event.key === "-") setScale((value) => Math.max(0.5, value - 0.15));
    }
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [pages.length]);

  useEffect(() => {
    if (!pdf || viewMode !== "double" || !secondaryCanvasRef.current || !secondaryPageShellRef.current || pageNumber >= pages.length) return;
    let cancelled = false; let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;
    void pdf.getPage(pageNumber + 1).then((pdfPage) => {
      if (cancelled || !secondaryCanvasRef.current || !secondaryPageShellRef.current) return;
      const viewport = pdfPage.getViewport({ scale, rotation });
      const canvas = secondaryCanvasRef.current; const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
      secondaryPageShellRef.current.style.width = viewport.width + "px"; secondaryPageShellRef.current.style.height = viewport.height + "px";
      renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      void renderTask.promise.catch((reason) => { if (!cancelled && !isPdfRenderCancellation(reason)) setError(reason instanceof Error ? reason.message : pdfLoadFailedMessage); });
    });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [pageNumber, pages.length, pdf, pdfLoadFailedMessage, rotation, scale, viewMode]);

  useEffect(() => {
    if (!pdf || viewMode !== "continuous") return;
    let cancelled = false;
    const renderTasks = new Map<number, { cancel: () => void; promise: Promise<unknown> }>();
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
      if (Math.abs(page.pageNumber - pageNumber) > 2) continue;
      void pdf.getPage(page.pageNumber).then((pdfPage) => {
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale, rotation });
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
        const shell = continuousPageRefs.current.get(page.pageNumber);
        if (shell) { shell.style.width = viewport.width + "px"; shell.style.height = viewport.height + "px"; shell.style.setProperty("--total-scale-factor", String(viewport.scale)); }
        const renderTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
        renderTasks.set(page.pageNumber, renderTask);
        void renderTask.promise.then(async () => {
          const layer = continuousTextLayerRefs.current.get(page.pageNumber);
          if (cancelled || !layer || !pdfjsRef.current) return;
          layer.replaceChildren();
          const textContent = await pdfPage.getTextContent();
          if (textContent.items.length) {
            await new pdfjsRef.current.TextLayer({ textContentSource: textContent, container: layer, viewport }).render();
          }
        }).catch((reason) => { if (!cancelled && !isPdfRenderCancellation(reason)) setError(reason instanceof Error ? reason.message : pdfLoadFailedMessage); }).finally(() => { if (renderTasks.get(page.pageNumber) === renderTask) renderTasks.delete(page.pageNumber); });
      });
    }
    return () => { cancelled = true; renderTasks.forEach((task) => task.cancel()); renderTasks.clear(); };
  }, [pageNumber, pages, pdf, pdfLoadFailedMessage, rotation, scale, viewMode]);

  const searchResults = useMemo(() => query.trim() ? pages.filter((page) => page.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0, 30) : [], [pages, query]);
  useEffect(() => {
    if (viewMode !== "continuous" || !viewportRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const nextPage = Number((visible?.target as HTMLElement | undefined)?.dataset.pageNumber);
      if (restoreContinuousPage.current !== null) {
        if (nextPage !== restoreContinuousPage.current) return;
        restoreContinuousPage.current = null;
      }
      if (!nextPage || nextPage === pageNumber) return;
      setPageNumber(nextPage);
      router.replace("/wiki/sources/" + sourceId + "/read/" + documentId + "?page=" + nextPage, { scroll: false });
    }, { root: viewportRef.current, threshold: [0.55, 0.8] });
    for (const element of continuousPageRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
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

  function updateUrl(nextPage: number) {
    setPageNumber(nextPage); router.replace(`/wiki/sources/${sourceId}/read/${documentId}?page=${nextPage}`, { scroll: false });
    if (viewMode === "continuous") window.setTimeout(() => continuousPageRefs.current.get(nextPage)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

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
    const result = await createPdfAnnotation({ documentId, pageNumber: annotationPageNumber, kind, geometry, selectedText, note, color: color as "yellow" | "green" | "blue" | "pink" | "purple", previewDataUrl });
    setAnnotations((items) => [...items, { id: result.id, pageNumber: annotationPageNumber, kind, selectedText, note, label: "", color, geometryJson: JSON.stringify(geometry), hasPreview: Boolean(previewDataUrl), createdBy: user.id, createdByName: user.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: [] }]);
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
    if (target) {
      setSpotlightTop(12);
      setAnnotationSpotlight({ annotationId: annotation.id });
      setMobilePanel(window.matchMedia("(min-width: 768px)").matches ? null : "spotlight");
    } else if (window.matchMedia("(min-width: 1024px)").matches) setShowAnnotations(true);
    else setMobilePanel("annotations");
    if (navigateToPage) updateUrl(annotation.pageNumber);
    router.replace("/wiki/sources/" + sourceId + "/read/" + documentId + "?page=" + (navigateToPage ? annotation.pageNumber : pageNumber) + "&annotation=" + annotation.id, { scroll: false });
    if (!target) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => annotationCardRefs.current.get(annotation.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" })));
    }
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
    const rects = displayAnnotationRects(annotation); if (!rects.length) return null;
    const top = (Math.min(...rects.map((rect) => rect.y)) + Math.max(...rects.map((rect) => rect.y + rect.height))) / 2;
    return <button type="button" key={`${annotation.id}-marker`} data-annotation-marker={annotation.id} data-testid="pdf-annotation-marker" onClick={(event) => openAnnotation(annotation, false, event.currentTarget)} aria-label={t("annotations")} className="pointer-events-auto absolute grid size-6 cursor-pointer place-items-center rounded-full border border-border/70 bg-background/90 text-indigo-600 shadow-sm backdrop-blur-sm transition-[transform,box-shadow] hover:scale-105 hover:shadow" style={{ left: "calc(100% + 10px)", top: `${top * 100}%`, transform: "translateY(-50%)" }}><MessageCircle className="size-3.5" /></button>;
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

  async function fitWidth() {
    if (!pdf || !viewportRef.current) return;
    const pdfPage = await pdf.getPage(pageNumber); const base = pdfPage.getViewport({ scale: 1, rotation });
    setScale(Math.min(3, Math.max(0.5, (viewportRef.current.clientWidth - 32) / base.width)));
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
      scheduleSpotlightPosition();
      if (zoomCommitTimeoutRef.current !== null) window.clearTimeout(zoomCommitTimeoutRef.current);
      zoomCommitTimeoutRef.current = window.setTimeout(() => {
        zoomCommitTimeoutRef.current = null;
        const finalScale = zoomScaleRef.current;
        if (Math.abs(finalScale - scaleRef.current) < 0.001) {
          content.style.removeProperty("zoom");
          return;
        }
        zoomCommitPendingRef.current = true;
        setScale(finalScale);
      }, 120);
    });
  }, [scheduleSpotlightPosition]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handleViewportWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleViewportWheel);
  }, [handleViewportWheel]);

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

  const thumbnailTools = <><div className="relative mb-2"><Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 pl-7 text-xs" placeholder={t("searchInPdf")} /></div>{query && <div className="mb-3 space-y-1">{searchResults.map((page) => <button key={page.pageNumber} className="block w-full rounded border p-2 text-left text-xs hover:bg-accent" onClick={() => updateUrl(page.pageNumber)}><strong>{t("pageNumber", { page: page.pageNumber })}</strong><span className="mt-1 line-clamp-2 block text-muted-foreground">{page.text}</span></button>)}</div>}
    <div className="space-y-2">{pages.map((page) => <button key={page.pageNumber} className={`w-full rounded border p-1 ${page.pageNumber === pageNumber ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "bg-muted/20"}`} onClick={() => { updateUrl(page.pageNumber); setMobilePanel(null); }}><img src={"/api/wiki/pdf-documents/" + documentId + "/pages/" + page.pageNumber + "/thumbnail"} alt="" className="mx-auto min-h-28 max-h-36" loading="lazy" /><span className="mt-1 block text-[10px]">{page.pageNumber}</span></button>)}</div></>;
  const annotationTools = !annotations.length ? <p className="text-xs text-muted-foreground">{t("noAnnotations")}</p> : <div className="space-y-2">{annotations.map((annotation) => <article ref={(element) => { if (element) annotationCardRefs.current.set(annotation.id, element); else annotationCardRefs.current.delete(annotation.id); }} key={annotation.id} className={`rounded-lg border p-2 text-xs ${activeAnnotationId === annotation.id ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20" : ""}`}><button className="w-full text-left" onClick={() => openAnnotation(annotation, true)}><span className="flex items-center gap-1 font-medium">{annotation.label || t(`annotationKinds.${annotation.kind}`)} · {t("pageNumber", { page: annotation.pageNumber })}{(annotation.note || annotation.comments.length > 0) && <MessageCircle className="size-3 text-indigo-600" />}</span>{annotation.note && <p className="mt-2 text-muted-foreground">{annotation.note}</p>}<p className="mt-2 text-[10px] text-muted-foreground">{annotation.createdByName}</p></button><div className="mt-2 space-y-2 border-t pt-2">{annotation.comments.map((comment) => <div key={comment.id} className="rounded bg-muted/60 p-2"><p>{comment.body}</p><p className="mt-1 text-[10px] text-muted-foreground">{comment.createdByName}</p></div>)}<Textarea rows={2} value={replyByAnnotation[annotation.id] ?? ""} onChange={(event) => setReplyByAnnotation((items) => ({ ...items, [annotation.id]: event.target.value }))} placeholder={t("replyToAnnotation")} /><Button size="sm" disabled={!replyByAnnotation[annotation.id]?.trim()} onClick={() => void submitReply(annotation.id)}>{t("sendReply")}</Button></div>{(annotation.createdBy === user.id || user.role === "admin") && <Button className="mt-1" size="icon-xs" variant="ghost" onClick={async () => { await deletePdfAnnotation(annotation.id); setAnnotations((items) => items.filter((item) => item.id !== annotation.id)); }}><Trash2 className="size-3" /></Button>}</article>)}</div>;
  const spotlightAnnotation = annotationSpotlight ? annotations.find((annotation) => annotation.id === annotationSpotlight.annotationId) : undefined;
  function renderSpotlightThread() {
    if (!spotlightAnnotation) return null;
    return <>
      <div data-testid="pdf-annotation-thread" className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-1 pt-3.5">
        {spotlightAnnotation.note && <p className="pr-8 text-[13px] leading-5 text-foreground/90">{spotlightAnnotation.note}</p>}
        {spotlightAnnotation.comments.length > 0 && <div className={`space-y-2 ${spotlightAnnotation.note ? "mt-2.5 border-t border-border/60 pt-2.5" : "pr-8"}`}>{spotlightAnnotation.comments.map((comment) => {
          const editing = editingCommentId === comment.id; const canEdit = comment.createdBy === user.id || user.role === "admin";
          return <div key={comment.id} className="group border-l border-border/70 py-0.5 pl-2.5 pr-1">{editing ? <div className="relative"><Textarea autoFocus rows={1} className="max-h-28 min-h-9 resize-none rounded-lg border-border/70 bg-transparent py-1.5 pr-8 text-[13px] shadow-none focus-visible:ring-1" value={commentDraftById[comment.id] ?? ""} onChange={(event) => setCommentDraftById((items) => ({ ...items, [comment.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveEditedReply(spotlightAnnotation.id, comment.id); } if (event.key === "Escape") { event.preventDefault(); setEditingCommentId(null); } }} /><Button type="button" variant="ghost" size="icon-xs" aria-label={t("sendReply")} className="absolute bottom-1 right-1 rounded-full" disabled={!commentDraftById[comment.id]?.trim()} onClick={() => void saveEditedReply(spotlightAnnotation.id, comment.id)}><ArrowUp className="size-3.5" /></Button></div> : <div className="flex items-end gap-1.5"><p className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] leading-5 text-foreground/85">{comment.body}</p>{canEdit && <Button type="button" variant="ghost" size="icon-xs" aria-label={t("editReply")} className="shrink-0 rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => beginEditingReply(comment)}><Pencil className="size-3" /></Button>}</div>}</div>;
        })}</div>}
      </div>
      <div className="shrink-0 p-2.5 pt-2"><div className="relative"><Textarea data-testid="pdf-annotation-reply" rows={1} className="max-h-28 min-h-10 w-full resize-none rounded-xl border-border/70 bg-muted/20 px-3 py-2 pr-10 text-sm shadow-none transition-[background-color,border-color] focus-visible:bg-background focus-visible:ring-1" value={replyByAnnotation[spotlightAnnotation.id] ?? ""} onChange={(event) => setReplyByAnnotation((items) => ({ ...items, [spotlightAnnotation.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submitReply(spotlightAnnotation.id); } }} placeholder={t("replyToAnnotation")} /><Button type="button" variant="ghost" size="icon-sm" aria-label={t("sendReply")} className="absolute bottom-1 right-1 rounded-full text-muted-foreground enabled:text-foreground enabled:hover:bg-foreground/5" disabled={!replyByAnnotation[spotlightAnnotation.id]?.trim()} onClick={() => void submitReply(spotlightAnnotation.id)}><ArrowUp className="size-4" /></Button></div></div>
    </>;
  }

  const gridColumns = annotationSpotlight
    ? showThumbnails
      ? styles.spotlightGridWithThumbnails
      : styles.spotlightGrid
    : showThumbnails && showAnnotations
      ? "lg:grid-cols-[11rem_minmax(0,1fr)_19rem]"
      : showThumbnails
        ? "lg:grid-cols-[11rem_minmax(0,1fr)]"
        : showAnnotations
          ? "lg:grid-cols-[minmax(0,1fr)_19rem]"
          : "lg:grid-cols-1";


  if (error) return <div className="grid min-h-screen place-items-center p-8 text-center"><div><p className="text-destructive">{error}</p><Link className={buttonVariants({ className: "mt-3" })} href={"/wiki/sources/" + sourceId}>{t("backToSource")}</Link></div></div>;

  return <main className="flex h-dvh min-h-0 flex-col bg-transparent">
    <header className="flex flex-wrap items-center gap-2 border-b bg-background p-2 shadow-sm"><Link aria-label={t("backToSource")} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} href="/wiki/sources"><ArrowLeft className="size-4" /></Link><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{sourceTitle}</p><p className="truncate text-[11px] text-muted-foreground">{fileName}</p></div>
      <Button variant="outline" size="icon-sm" disabled={pageNumber <= 1} onClick={() => updateUrl(pageNumber - 1)}><ChevronLeft className="size-4" /></Button><Input className="h-8 w-16 text-center" inputMode="numeric" value={pageNumber} onChange={(event) => { const page = Number(event.target.value); if (Number.isInteger(page) && page >= 1 && page <= pages.length) updateUrl(page); }} /><span className="text-xs text-muted-foreground">/ {pages.length}</span><Button variant="outline" size="icon-sm" disabled={pageNumber >= pages.length} onClick={() => updateUrl(pageNumber + 1)}><ChevronRight className="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" onClick={() => setScale((value) => Math.max(0.5, value - 0.15))}><Minus className="size-4" /></Button><button ref={zoomLabelRef} className="w-12 text-xs tabular-nums" onClick={() => void fitWidth()} title={t("fitWidth")}>{Math.round(scale * 100)}%</button><Button data-testid="pdf-zoom-in" variant="ghost" size="icon-sm" onClick={() => setScale((value) => Math.min(3, value + 0.15))}><Plus className="size-4" /></Button><Button variant="ghost" size="icon-sm" onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw className="size-4" /></Button>
      <select aria-label={t("annotationColor")} value={color} onChange={(event) => setColor(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">{Object.keys(COLORS).map((item) => <option key={item} value={item}>{t(`annotationColors.${item}`)}</option>)}</select>
      <Button variant={regionMode ? "secondary" : "ghost"} size="sm" onClick={() => { if (viewMode === "continuous") setViewMode("single"); setRegionMode((value) => !value); }}><Crop className="size-4" />{t("captureRegion")}</Button><select aria-label={t("viewMode")} value={viewMode} onChange={(event) => changeViewMode(event.target.value as "continuous" | "single" | "double")} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="continuous">{t("continuousView")}</option><option value="single">{t("singlePageView")}</option><option value="double">{t("doublePageView")}</option></select><Button variant="ghost" size="sm" onClick={() => requestAnnotation({ kind: "bookmark", geometry: [], selectedText: "", pageNumber })}><Bookmark className="size-4" />{t("bookmarkPage")}</Button>
      <Button className="hidden lg:inline-flex" variant={showThumbnails ? "secondary" : "ghost"} size="icon-sm" aria-label={showThumbnails ? t("hideThumbnails") : t("showThumbnails")} aria-pressed={showThumbnails} title={showThumbnails ? t("hideThumbnails") : t("showThumbnails")} onClick={() => setShowThumbnails((value) => !value)}><PanelLeft className="size-4" /></Button>
      <Button className="hidden lg:inline-flex" variant={showAnnotations ? "secondary" : "ghost"} size="icon-sm" aria-label={showAnnotations ? t("hideAnnotations") : t("showAnnotations")} aria-pressed={showAnnotations} title={showAnnotations ? t("hideAnnotations") : t("showAnnotations")} onClick={() => setShowAnnotations((value) => !value)}><PanelRight className="size-4" /></Button>
      <Button className="lg:hidden" variant="ghost" size="icon-sm" aria-label={t("showThumbnails")} title={t("showThumbnails")} onClick={() => setMobilePanel("thumbnails")}><PanelLeft className="size-4" /></Button>
      <Button className="lg:hidden" variant="ghost" size="icon-sm" aria-label={t("showAnnotations")} title={t("showAnnotations")} onClick={() => setMobilePanel("annotations")}><PanelRight className="size-4" /></Button>
      <FocusModeToggle compact />
    </header>
    <div className={`grid min-h-0 flex-1 grid-cols-1 ${gridColumns}`}>
      {showThumbnails && <aside data-testid="pdf-thumbnails-panel" className="hidden overflow-y-auto border-r bg-background p-2 lg:block">{thumbnailTools}</aside>}
      <section ref={viewportRef} data-testid="pdf-reader-viewport" className="relative overflow-auto [overflow-anchor:none] p-4" onMouseUp={captureSelection}>{!pdf || (rendering && viewMode !== "continuous") ? <div className="absolute inset-0 z-20 grid place-items-center pointer-events-none"><Loader2 className="size-7 animate-spin text-indigo-500" /></div> : null}{viewMode === "continuous" ? <div ref={zoomContentRef} className="space-y-4">{pages.map((page) => <div key={page.pageNumber} data-page-number={page.pageNumber} ref={(element) => { if (element) continuousPageRefs.current.set(page.pageNumber, element); else continuousPageRefs.current.delete(page.pageNumber); }} className={`${styles.pageShell} ${annotationSpotlight ? "ml-auto mr-10" : ""}`}><canvas ref={(element) => { if (element) continuousCanvasRefs.current.set(page.pageNumber, element); else continuousCanvasRefs.current.delete(page.pageNumber); }} className="block" /><div ref={(element) => { if (element) continuousTextLayerRefs.current.set(page.pageNumber, element); else continuousTextLayerRefs.current.delete(page.pageNumber); }} className={styles.textLayer} /><div className="pointer-events-none absolute inset-0 z-[3]">{annotations.filter((annotation) => annotation.pageNumber === page.pageNumber).flatMap((annotation) => displayAnnotationRects(annotation).map((rect, index) => <div data-annotation-rect={annotation.id} key={annotation.id + "-" + index} className={`absolute `} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: COLORS[annotation.color] || COLORS.yellow }} />))}{annotations.filter((annotation) => annotation.pageNumber === page.pageNumber).map(annotationMarker)}</div></div>)}</div> : <div ref={zoomContentRef} className={`flex items-start gap-4 ${annotationSpotlight ? "justify-end pr-10" : "justify-center"}`}><div ref={pageShellRef} className={`${styles.pageShell} ${annotationSpotlight ? "ml-auto mr-10" : ""}`}><canvas ref={canvasRef} className="block" /><div ref={textLayerRef} className={styles.textLayer} />
        <div className="pointer-events-none absolute inset-0 z-[3]">{pageAnnotations.flatMap((annotation) => displayAnnotationRects(annotation).map((rect, index) => <div data-annotation-rect={annotation.id} key={annotation.id + "-" + index} className={`absolute `} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: COLORS[annotation.color] || COLORS.yellow }} />))}{pageAnnotations.map(annotationMarker)}{region && <div className="absolute border-2 border-indigo-600 bg-indigo-500/10" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}</div>
        {regionMode && <div data-testid="pdf-region-selector" className="absolute inset-0 z-[5] cursor-crosshair" onPointerDown={(event) => { regionStart.current = regionPoint(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!regionStart.current) return; const end = regionPoint(event); setRegion({ x: Math.min(regionStart.current.x, end.x), y: Math.min(regionStart.current.y, end.y), width: Math.abs(end.x - regionStart.current.x), height: Math.abs(end.y - regionStart.current.y) }); }} onPointerUp={(event) => { const start = regionStart.current; if (start) { const end = regionPoint(event); setRegion({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }); const bounds = event.currentTarget.getBoundingClientRect(); setSelectionAnchor({ pageNumber, x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, side: "right" }); } if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); regionStart.current = null; }} />}
      </div>{viewMode === "double" && pageNumber < pages.length && <div ref={secondaryPageShellRef} className={`${styles.pageShell} ${annotationSpotlight ? "ml-auto mr-10" : ""}`}><canvas ref={secondaryCanvasRef} className="block" /></div>}</div>}{selection && selectionAnchorPosition && <div data-testid="pdf-selection-actions" className="fixed z-40 flex gap-1 rounded-lg border bg-background p-1 shadow-xl" style={selectionActionsStyle(selectionAnchorPosition)}><Button size="sm" onClick={() => void saveAnnotation("text", selection.rects, selection.text, undefined, selection.pageNumber, "", true)}><Highlighter className="size-4" />{t("highlight")}</Button><Button size="sm" variant="outline" onClick={() => requestAnnotation({ kind: "text", geometry: selection.rects, selectedText: selection.text, pageNumber: selection.pageNumber })}><MessageCircle className="size-4" />{t("note")}</Button></div>}{region && selectionAnchorPosition && <div data-testid="pdf-selection-actions" className="fixed z-40 flex gap-1 rounded-lg border bg-background p-1 shadow-xl" style={selectionActionsStyle(selectionAnchorPosition)}><Button size="sm" onClick={() => void saveAnnotation("region", [region], "", previewForRegion(region), pageNumber, "", true)}><Highlighter className="size-4" />{t("highlight")}</Button><Button size="sm" variant="outline" onClick={() => requestAnnotation({ kind: "region", geometry: [region], selectedText: "", previewDataUrl: previewForRegion(region), pageNumber })}><MessageCircle className="size-4" />{t("note")}</Button><Button size="sm" variant="ghost" onClick={() => { setRegion(null); setSelectionAnchor(null); }}>{t("cancel")}</Button></div>}</section>
      {annotationSpotlight && spotlightAnnotation && <aside ref={spotlightAsideRef} data-testid="pdf-annotation-spotlight" className="relative hidden overflow-hidden bg-transparent md:block"><section ref={spotlightPanelRef} data-testid="pdf-annotation-card" role="dialog" aria-label={t("annotations")} className="absolute inset-x-2 flex max-h-[calc(100%_-_1.5rem)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/95 shadow-[0_14px_38px_-22px_rgb(15_23_42/0.48)] backdrop-blur-sm" style={{ top: spotlightTop }}>
        <Button ref={spotlightCloseRef} type="button" variant="ghost" size="icon-xs" aria-label={t("cancel")} className="absolute right-2 top-2 z-10 rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground" onClick={closeAnnotationSpotlight}><X className="size-3.5" /></Button>
        {renderSpotlightThread()}
      </section></aside>}
      {showAnnotations && !annotationSpotlight && <aside data-testid="pdf-annotations-panel" className="hidden overflow-y-auto border-l bg-background p-3 lg:block"><h2 className="mb-3 text-sm font-semibold">{t("annotations")}</h2>{annotationTools}</aside>}
    </div>
    <Sheet open={mobilePanel !== null} onOpenChange={(open) => { if (!open) { if (mobilePanel === "spotlight") closeAnnotationSpotlight(); else setMobilePanel(null); } }}>
      <SheetContent side={mobilePanel === "thumbnails" ? "left" : mobilePanel === "spotlight" ? "bottom" : "right"} showCloseButton={mobilePanel !== "spotlight"} className={mobilePanel === "spotlight" ? "max-h-[min(70dvh,32rem)] rounded-t-2xl" : "w-[min(22rem,88vw)]"}>
        {mobilePanel === "spotlight" ? <><SheetHeader className="sr-only"><SheetTitle>{t("annotations")}</SheetTitle><SheetDescription>{t("annotationsDescription")}</SheetDescription></SheetHeader><div data-testid="pdf-annotation-mobile-sheet" className="relative flex min-h-0 flex-1 flex-col pt-1"><Button ref={spotlightCloseRef} type="button" variant="ghost" size="icon-xs" aria-label={t("cancel")} className="absolute right-3 top-2 z-10 rounded-full" onClick={closeAnnotationSpotlight}><X className="size-3.5" /></Button>{renderSpotlightThread()}</div></> : <><SheetHeader><SheetTitle>{mobilePanel === "thumbnails" ? t("thumbnails") : t("annotations")}</SheetTitle><SheetDescription className="sr-only">{mobilePanel === "thumbnails" ? t("pdfNavigationDescription") : t("annotationsDescription")}</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{mobilePanel === "thumbnails" ? thumbnailTools : annotationTools}</div></>}
      </SheetContent>
    </Sheet>
    <Dialog open={Boolean(pendingAnnotation)} onOpenChange={(open) => { if (!open) { setPendingAnnotation(null); setAnnotationAnchor(null); } }}><DialogContent style={annotationAnchor ? annotationPopupStyle(annotationAnchor) : undefined}><DialogHeader><DialogTitle>{t("annotationNotePrompt")}</DialogTitle></DialogHeader><Textarea autoFocus value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitPendingAnnotation(); } }} rows={4} /><DialogFooter><Button variant="outline" onClick={() => setPendingAnnotation(null)}>{t("cancel")}</Button><Button onClick={submitPendingAnnotation}>{t("saveAnnotation")}</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
