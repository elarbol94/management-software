/* eslint-disable @next/next/no-img-element -- Authenticated PDF thumbnails and annotation crops are served by private routes. */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ArrowLeft, Bookmark, ChevronLeft, ChevronRight, Crop, Highlighter,
  Loader2, MessageCircle, Minus, Plus, RotateCw, Search, Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createPdfAnnotation, createPdfAnnotationComment, deletePdfAnnotation } from "../pdf-actions";
import type { PdfRect } from "../lib/pdf-evidence";
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
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const pdfjsRef = useRef<typeof import("pdfjs-dist") | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.min(Math.max(initialPage, 1), Math.max(1, pages.length)));
  const [scale, setScale] = useState(1.25); const [rotation, setRotation] = useState(0);
  const [viewMode, setViewMode] = useState<"continuous" | "single" | "double">("continuous");
  const [rendering, setRendering] = useState(true); const [error, setError] = useState("");
  const [annotations, setAnnotations] = useState(initialAnnotations); const [color, setColor] = useState("yellow");
  const [activeAnnotationId, setActiveAnnotationId] = useState(initialAnnotationId ?? "");
  const [replyByAnnotation, setReplyByAnnotation] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<{ text: string; rects: PdfRect[]; pageNumber: number } | null>(null);
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null);
  const [annotationNote, setAnnotationNote] = useState("");
  const [regionMode, setRegionMode] = useState(false); const [region, setRegion] = useState<PdfRect | null>(null);
  const regionStart = useRef<{ x: number; y: number } | null>(null);
  const restoreContinuousPage = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null); const textLayerRef = useRef<HTMLDivElement>(null);
  const pageShellRef = useRef<HTMLDivElement>(null); const secondaryPageShellRef = useRef<HTMLDivElement>(null); const secondaryCanvasRef = useRef<HTMLCanvasElement>(null); const continuousCanvasRefs = useRef(new Map<number, HTMLCanvasElement>()); const continuousTextLayerRefs = useRef(new Map<number, HTMLDivElement>()); const continuousPageRefs = useRef(new Map<number, HTMLDivElement>()); const viewportRef = useRef<HTMLDivElement>(null);
  const currentPage = pages.find((page) => page.pageNumber === pageNumber);

  useEffect(() => {
    let cancelled = false; let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | undefined;
    void import("pdfjs-dist").then((pdfjs) => {
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      pdfjsRef.current = pdfjs;
      task = pdfjs.getDocument({ url: `/api/files/${attachmentId}`, disableAutoFetch: false, disableRange: false, disableStream: false });
      return task.promise;
    }).then((document) => { if (!cancelled && document) setPdf(document); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : t("pdfLoadFailed")); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [attachmentId, t]);

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
      }).catch((reason) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : t("pdfLoadFailed")); setRendering(false); } });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [currentPage?.extractionMethod, currentPage?.textLayerJson, pageNumber, pdf, rotation, scale, t, viewMode]);


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
    let cancelled = false;
    void pdf.getPage(pageNumber + 1).then((pdfPage) => {
      if (cancelled || !secondaryCanvasRef.current || !secondaryPageShellRef.current) return;
      const viewport = pdfPage.getViewport({ scale, rotation });
      const canvas = secondaryCanvasRef.current; const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
      secondaryPageShellRef.current.style.width = viewport.width + "px"; secondaryPageShellRef.current.style.height = viewport.height + "px";
      void pdfPage.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] }).promise;
    });
    return () => { cancelled = true; };
  }, [pageNumber, pages.length, pdf, rotation, scale, viewMode]);

  useEffect(() => {
    if (!pdf || viewMode !== "continuous") return;
    let cancelled = false;
    for (const page of pages) {
      const canvas = continuousCanvasRefs.current.get(page.pageNumber);
      if (!canvas) continue;
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
        void pdfPage.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] }).promise.then(async () => {
          const layer = continuousTextLayerRefs.current.get(page.pageNumber);
          if (cancelled || !layer || !pdfjsRef.current) return;
          layer.replaceChildren();
          const textContent = await pdfPage.getTextContent();
          if (textContent.items.length) {
            await new pdfjsRef.current.TextLayer({ textContentSource: textContent, container: layer, viewport }).render();
          }
        });
      });
    }
    return () => { cancelled = true; };
  }, [pages, pdf, rotation, scale, viewMode]);

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
    const targetPage = restoreContinuousPage.current ?? pageNumber;
    const timer = window.setTimeout(() => {
      continuousPageRefs.current.get(targetPage)?.scrollIntoView({ behavior: "auto", block: "start" });
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
    if (!browserSelection || browserSelection.isCollapsed || browserSelection.rangeCount === 0) { setSelection(null); return; }
    const selectedElement = browserSelection.getRangeAt(0).commonAncestorContainer.parentElement?.closest("[data-page-number]") as HTMLDivElement | null;
    const shell = selectedElement ?? pageShellRef.current;
    const selectedPageNumber = Number(selectedElement?.dataset.pageNumber) || pageNumber;
    if (selectedElement) setPageNumber(selectedPageNumber);
    if (!shell) { setSelection(null); return; }
    const text = browserSelection.toString().trim(); if (!text) return;
    const bounds = shell.getBoundingClientRect();
    const rects = Array.from(browserSelection.getRangeAt(0).getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom >= bounds.top && rect.top <= bounds.bottom).map((rect) => ({
      x: Math.max(0, rect.left - bounds.left) / bounds.width,
      y: Math.max(0, rect.top - bounds.top) / bounds.height,
      width: Math.min(rect.width, bounds.right - Math.max(rect.left, bounds.left)) / bounds.width,
      height: Math.min(rect.height, bounds.bottom - Math.max(rect.top, bounds.top)) / bounds.height,
    })).filter((rect) => rect.width > 0 && rect.height > 0);
    setSelection(rects.length ? { text, rects, pageNumber: selectedPageNumber } : null);
  }

  function requestAnnotation(annotation: PendingAnnotation) {
    setAnnotationNote(""); setPendingAnnotation(annotation);
  }

  async function saveAnnotation(kind: "text" | "region" | "bookmark", geometry: PdfRect[], selectedText = "", previewDataUrl?: string, annotationPageNumber = pageNumber, note = "") {
    const result = await createPdfAnnotation({ documentId, pageNumber: annotationPageNumber, kind, geometry, selectedText, note, color: color as "yellow" | "green" | "blue" | "pink" | "purple", previewDataUrl });
    setAnnotations((items) => [...items, { id: result.id, pageNumber: annotationPageNumber, kind, selectedText, note, label: "", color, geometryJson: JSON.stringify(geometry), hasPreview: Boolean(previewDataUrl), createdBy: user.id, createdByName: user.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), comments: [] }]);
    window.getSelection()?.removeAllRanges(); setSelection(null); setRegion(null); setRegionMode(false);
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

  function annotationRects(annotation: ReaderAnnotation) {
    try { return JSON.parse(annotation.geometryJson) as PdfRect[]; } catch { return []; }
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

  if (error) return <div className="grid min-h-screen place-items-center p-8 text-center"><div><p className="text-destructive">{error}</p><Link className={buttonVariants({ className: "mt-3" })} href={"/wiki/sources/" + sourceId}>{t("backToSource")}</Link></div></div>;

  return <main className="flex h-[calc(100vh-4rem)] min-h-[42rem] flex-col bg-slate-100 dark:bg-slate-950">
    <header className="flex flex-wrap items-center gap-2 border-b bg-background p-2 shadow-sm"><Link aria-label={t("backToSource")} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} href="/wiki/sources"><ArrowLeft className="size-4" /></Link><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{sourceTitle}</p><p className="truncate text-[11px] text-muted-foreground">{fileName}</p></div>
      <Button variant="outline" size="icon-sm" disabled={pageNumber <= 1} onClick={() => updateUrl(pageNumber - 1)}><ChevronLeft className="size-4" /></Button><Input className="h-8 w-16 text-center" inputMode="numeric" value={pageNumber} onChange={(event) => { const page = Number(event.target.value); if (Number.isInteger(page) && page >= 1 && page <= pages.length) updateUrl(page); }} /><span className="text-xs text-muted-foreground">/ {pages.length}</span><Button variant="outline" size="icon-sm" disabled={pageNumber >= pages.length} onClick={() => updateUrl(pageNumber + 1)}><ChevronRight className="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" onClick={() => setScale((value) => Math.max(0.5, value - 0.15))}><Minus className="size-4" /></Button><button className="w-12 text-xs tabular-nums" onClick={() => void fitWidth()} title={t("fitWidth")}>{Math.round(scale * 100)}%</button><Button variant="ghost" size="icon-sm" onClick={() => setScale((value) => Math.min(3, value + 0.15))}><Plus className="size-4" /></Button><Button variant="ghost" size="icon-sm" onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw className="size-4" /></Button>
      <select aria-label={t("annotationColor")} value={color} onChange={(event) => setColor(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">{Object.keys(COLORS).map((item) => <option key={item} value={item}>{t(`annotationColors.${item}`)}</option>)}</select>
      <Button variant={regionMode ? "secondary" : "ghost"} size="sm" onClick={() => { if (viewMode === "continuous") setViewMode("single"); setRegionMode((value) => !value); }}><Crop className="size-4" />{t("captureRegion")}</Button><select aria-label={t("viewMode")} value={viewMode} onChange={(event) => changeViewMode(event.target.value as "continuous" | "single" | "double")} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="continuous">{t("continuousView")}</option><option value="single">{t("singlePageView")}</option><option value="double">{t("doublePageView")}</option></select><Button variant="ghost" size="sm" onClick={() => requestAnnotation({ kind: "bookmark", geometry: [], selectedText: "", pageNumber })}><Bookmark className="size-4" />{t("bookmarkPage")}</Button>
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[11rem_minmax(0,1fr)_19rem]">
      <aside className="hidden overflow-y-auto border-r bg-background p-2 lg:block"><div className="relative mb-2"><Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 pl-7 text-xs" placeholder={t("searchInPdf")} /></div>{query && <div className="mb-3 space-y-1">{searchResults.map((page) => <button key={page.pageNumber} className="block w-full rounded border p-2 text-left text-xs hover:bg-accent" onClick={() => updateUrl(page.pageNumber)}><strong>{t("pageNumber", { page: page.pageNumber })}</strong><span className="mt-1 line-clamp-2 block text-muted-foreground">{page.text}</span></button>)}</div>}
        <div className="space-y-2">{pages.map((page) => <button key={page.pageNumber} className={`w-full rounded border p-1 ${page.pageNumber === pageNumber ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : "bg-muted/20"}`} onClick={() => updateUrl(page.pageNumber)}><img src={"/api/wiki/pdf-documents/" + documentId + "/pages/" + page.pageNumber + "/thumbnail"} alt="" className="mx-auto min-h-28 max-h-36" loading="lazy" /><span className="mt-1 block text-[10px]">{page.pageNumber}</span></button>)}</div></aside>
      <section ref={viewportRef} className="relative overflow-auto p-4" onMouseUp={captureSelection} onWheelCapture={(event) => { if (!event.ctrlKey) return; event.preventDefault(); event.stopPropagation(); const viewport = event.currentTarget; const rect = viewport.getBoundingClientRect(); const previousScale = scale; const nextScale = Math.min(3, Math.max(0.5, previousScale + (event.deltaY < 0 ? 0.1 : -0.1))); if (nextScale === previousScale) return; const cursorX = event.clientX - rect.left; const cursorY = event.clientY - rect.top; const contentX = viewport.scrollLeft + cursorX; const contentY = viewport.scrollTop + cursorY; setScale(nextScale); window.requestAnimationFrame(() => { const ratio = nextScale / previousScale; viewport.scrollLeft = contentX * ratio - cursorX; viewport.scrollTop = contentY * ratio - cursorY; }); }}>{!pdf || (rendering && viewMode !== "continuous") ? <div className="absolute inset-0 z-20 grid place-items-center pointer-events-none"><Loader2 className="size-7 animate-spin text-indigo-500" /></div> : null}{viewMode === "continuous" ? <div className="space-y-4">{pages.map((page) => <div key={page.pageNumber} data-page-number={page.pageNumber} ref={(element) => { if (element) continuousPageRefs.current.set(page.pageNumber, element); else continuousPageRefs.current.delete(page.pageNumber); }} className={styles.pageShell}><canvas ref={(element) => { if (element) continuousCanvasRefs.current.set(page.pageNumber, element); else continuousCanvasRefs.current.delete(page.pageNumber); }} className="block" /><div ref={(element) => { if (element) continuousTextLayerRefs.current.set(page.pageNumber, element); else continuousTextLayerRefs.current.delete(page.pageNumber); }} className={styles.textLayer} /><div className="pointer-events-none absolute inset-0 z-[3]">{annotations.filter((annotation) => annotation.pageNumber === page.pageNumber).flatMap((annotation) => annotationRects(annotation).map((rect, index) => <div key={`${annotation.id}-${index}`} className={`absolute border ${activeAnnotationId === annotation.id ? "border-indigo-600 ring-2 ring-indigo-500/70" : "border-transparent"}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: COLORS[annotation.color] || COLORS.yellow }} />))}</div></div>)}</div> : <div className="flex items-start justify-center gap-4"><div ref={pageShellRef} className={styles.pageShell}><canvas ref={canvasRef} className="block" /><div ref={textLayerRef} className={styles.textLayer} />
        <div className="pointer-events-none absolute inset-0 z-[3]">{pageAnnotations.flatMap((annotation) => annotationRects(annotation).map((rect, index) => <div key={`${annotation.id}-${index}`} title={annotation.note || annotation.selectedText} className={`absolute border ${activeAnnotationId === annotation.id ? "border-indigo-600 ring-2 ring-indigo-500/70" : "border-transparent"}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, backgroundColor: COLORS[annotation.color] || COLORS.yellow, borderColor: activeAnnotationId === annotation.id ? "rgb(79 70 229 / 0.75)" : "transparent" }} />))}{region && <div className="absolute border-2 border-indigo-600 bg-indigo-500/10" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}</div>
        {regionMode && <div className="absolute inset-0 z-[5] cursor-crosshair" onPointerDown={(event) => { regionStart.current = regionPoint(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!regionStart.current) return; const end = regionPoint(event); setRegion({ x: Math.min(regionStart.current.x, end.x), y: Math.min(regionStart.current.y, end.y), width: Math.abs(end.x - regionStart.current.x), height: Math.abs(end.y - regionStart.current.y) }); }} onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); regionStart.current = null; }} />}
      </div>{viewMode === "double" && pageNumber < pages.length && <div ref={secondaryPageShellRef} className={styles.pageShell}><canvas ref={secondaryCanvasRef} className="block" /></div>}</div>}{selection && <div className="sticky bottom-4 z-30 mx-auto mt-3 flex w-fit items-center gap-2 rounded-full border bg-background p-1 shadow-xl"><span className="max-w-64 truncate px-2 text-xs">{selection.text}</span><Button size="sm" onClick={() => requestAnnotation({ kind: "text", geometry: selection.rects, selectedText: selection.text, pageNumber: selection.pageNumber })}><Highlighter className="size-4" />{t("highlightSelection")}</Button></div>}{region && <div className="sticky bottom-4 z-30 mx-auto mt-3 flex w-fit gap-2 rounded-full border bg-background p-1 shadow-xl"><Button size="sm" onClick={() => requestAnnotation({ kind: "region", geometry: [region], selectedText: "", previewDataUrl: previewForRegion(region), pageNumber })}><Crop className="size-4" />{t("saveRegion")}</Button><Button size="sm" variant="ghost" onClick={() => setRegion(null)}>{t("cancel")}</Button></div>}</section>
      <aside className="overflow-y-auto border-l bg-background p-3"><h2 className="mb-3 text-sm font-semibold">{t("annotations")}</h2>{!annotations.length ? <p className="text-xs text-muted-foreground">{t("noAnnotations")}</p> : <div className="space-y-2">{annotations.map((annotation) => <article key={annotation.id} className={`rounded-lg border p-2 text-xs ${activeAnnotationId === annotation.id ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20" : ""}`}><button className="w-full text-left" onClick={() => { setActiveAnnotationId(annotation.id); updateUrl(annotation.pageNumber); router.replace(`/wiki/sources/${sourceId}/read/${documentId}?page=${annotation.pageNumber}&annotation=${annotation.id}`, { scroll: false }); }}><span className="flex items-center gap-1 font-medium">{annotation.label || t(`annotationKinds.${annotation.kind}`)} · {t("pageNumber", { page: annotation.pageNumber })}{(annotation.note || annotation.comments.length > 0) && <MessageCircle className="size-3 text-indigo-600" />}</span>{annotation.hasPreview && <img src={`/api/wiki/pdf-annotations/${annotation.id}/preview`} alt="" className="mt-2 max-h-36 rounded border" />}{annotation.selectedText && <blockquote className="mt-2 line-clamp-4 border-l-2 pl-2 italic">“{annotation.selectedText}”</blockquote>}{annotation.note && <p className="mt-2 text-muted-foreground">{annotation.note}</p>}<p className="mt-2 text-[10px] text-muted-foreground">{annotation.createdByName}</p></button><div className="mt-2 space-y-2 border-t pt-2">{annotation.comments.map((comment) => <div key={comment.id} className="rounded bg-muted/60 p-2"><p>{comment.body}</p><p className="mt-1 text-[10px] text-muted-foreground">{comment.createdByName}</p></div>)}<Textarea rows={2} value={replyByAnnotation[annotation.id] ?? ""} onChange={(event) => setReplyByAnnotation((items) => ({ ...items, [annotation.id]: event.target.value }))} placeholder={t("replyToAnnotation")} /><Button size="sm" disabled={!replyByAnnotation[annotation.id]?.trim()} onClick={() => void submitReply(annotation.id)}>{t("sendReply")}</Button></div>{(annotation.createdBy === user.id || user.role === "admin") && <Button className="mt-1" size="icon-xs" variant="ghost" onClick={async () => { await deletePdfAnnotation(annotation.id); setAnnotations((items) => items.filter((item) => item.id !== annotation.id)); }}><Trash2 className="size-3" /></Button>}</article>)}</div>}</aside>
    </div>
    <Dialog open={Boolean(pendingAnnotation)} onOpenChange={(open) => { if (!open) setPendingAnnotation(null); }}><DialogContent><DialogHeader><DialogTitle>{t("annotationNotePrompt")}</DialogTitle></DialogHeader><Textarea autoFocus value={annotationNote} onChange={(event) => setAnnotationNote(event.target.value)} rows={4} /><DialogFooter><Button variant="outline" onClick={() => setPendingAnnotation(null)}>{t("cancel")}</Button><Button onClick={() => { if (!pendingAnnotation) return; void saveAnnotation(pendingAnnotation.kind, pendingAnnotation.geometry, pendingAnnotation.selectedText, pendingAnnotation.previewDataUrl, pendingAnnotation.pageNumber, annotationNote).then(() => setPendingAnnotation(null)); }}>{t("saveRegion")}</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
