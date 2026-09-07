"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { presentationSource, presentationSourceOwner, sourceKey, sourceReviewStatus, type PresentationSource, type PresentationSourceDocument } from "../lib/presentation-source";
import { isPresentationElementLocked, stepLabel, type PresentationElement } from "../lib/presentation";
import type { PresentationSourcePreviewsState } from "./use-presentation-source-previews";

export function PresentationSourcePanel({ elements, selected, disabled, previews, onChange, onOpen, onReview, onSelect }: {
  previews: PresentationSourcePreviewsState;
  elements: PresentationElement[]; selected: PresentationElement | null; disabled: boolean;
  onReview: (elementId: string, source: PresentationSource) => void;
  onSelect: (elementId: string) => void;
  onChange: (source: PresentationSource | null | undefined) => void;
  onOpen: (document: PresentationSourceDocument, sectionId: string) => void;
}) {
  const t = useTranslations("documentPresentationLinks");
  const [documents, setDocuments] = useState<PresentationSourceDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pageId, setPageId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [filter, setFilter] = useState("");
  const owner = selected ? presentationSourceOwner(elements, selected.id) : null;
  const source = selected ? presentationSource(elements, selected.id) : null;
  const preview = source ? previews.previews.get(sourceKey(source)) : undefined;
  const status = source && preview ? sourceReviewStatus(source, preview) : null;
  const attention = elements.flatMap((element, index) => {
    const current = element.source && previews.previews.get(sourceKey(element.source));
    if (!element.source || !current) return [];
    const status = sourceReviewStatus(element.source, current);
    return status === "current" ? [] : [{ id: element.id, label: stepLabel(element, index), status }];
  });
  const document = documents.find((item) => item.id === source?.pageId);
  const section = document?.sections.find((item) => item.id === source?.sectionId);
  const pickedDocument = documents.find((item) => item.id === pageId);
  async function load() {
    setError(false);
    try {
      const response = await fetch("/api/wiki/presentation-sources", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json(); setDocuments(result.documents); setLoaded(true);
    } catch { setError(true); }
  }
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void fetch("/api/wiki/presentation-sources", { cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json(); setDocuments(result.documents); setLoaded(true); setError(false);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    };
    refresh(); window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEditing(false));
    return () => cancelAnimationFrame(frame);
  }, [selected?.id]);
  if (!selected && !elements.some((element) => element.source)) return null;
  const missing = loaded && source && (!document || (source.sectionId && !section));
  return <section className="mb-4 space-y-2 rounded-md border p-3" aria-label={t("source")}>
    <h2 className="flex items-center gap-2 text-sm font-medium"><Link2 className="size-4" />{t("source")}</h2>
    {elements.some((element) => element.source) && <div className="space-y-2 border-b pb-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs" role="status">{previews.error ? t("previewFailed") : previews.loading ? t("checkingSources") : attention.length ? t("needsReview", { count: attention.length }) : t("allSourcesCurrent")}</p>
        <Button size="icon-sm" variant="ghost" aria-label={t("refreshSources")} onClick={previews.refresh}><RefreshCw className="size-3.5" /></Button>
      </div>
      {attention.length > 0 && <details><summary className="cursor-pointer text-xs">{t("reviewSources")}</summary><ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">{attention.map((item) => <li key={item.id}><button type="button" className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted" onClick={() => onSelect(item.id)}>{item.label} · {t(item.status)}</button></li>)}</ul></details>}
    </div>}
    {selected && <>
    {error ? <Button size="sm" variant="outline" onClick={() => void load()}>{t("retry")}</Button> : !loaded ? <p className="text-xs text-muted-foreground">{t("loading")}</p> : source ? <>
      <p className="break-words text-xs text-muted-foreground">{document?.title}{section ? ` › ${preview?.snapshot?.headingTitle ?? section.title}` : ""}</p>
      {selected.source === undefined && <p className="text-xs text-muted-foreground">{t("inherited")}</p>}
      {missing && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("missingSource")}</p>}
      {source && <div className="space-y-2 rounded-md bg-muted/50 p-2" aria-label={t("preview")}>
        <p role="status" className={status === "changed" || status === "missing" ? "text-xs font-medium text-amber-700 dark:text-amber-300" : "text-xs font-medium"}>{previews.error ? t("previewFailed") : status ? t(status) : t("checkingSources")}</p>
        {preview?.snapshot && <>
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs">{preview.snapshot.text || t("emptyPreview")}</p>
          {preview.snapshot.imageCount > 0 && <p className="text-xs text-muted-foreground">{t("previewImages", { count: preview.snapshot.imageCount })}</p>}
          {preview.snapshot.truncated && <p className="text-xs text-muted-foreground">{t("previewTruncated")}</p>}
          {status !== "current" && <>
            <p className="text-xs text-muted-foreground">{t("reviewHint")}</p>
            {owner && owner.id !== selected.id && <p className="text-xs text-muted-foreground">{t("reviewInheritedHint")}</p>}
            <Button size="sm" variant="outline" disabled={disabled || previews.error || !owner || isPresentationElementLocked(elements, owner.id)} onClick={() => { if (owner) onReview(owner.id, { ...source, reviewedFingerprint: preview.snapshot!.fingerprint }); }}>{t("markReviewed")}</Button>
          </>}
        </>}
      </div>}
      {document && <Button size="sm" variant="outline" className="w-full" onClick={async () => {
        try {
          const response = await fetch(`/api/wiki/presentation-sources?source=${encodeURIComponent(document.id)}`, { cache: "no-store" });
          if (!response.ok) throw new Error();
          const result = await response.json();
          if (!result.document) { toast.error(t("missingSource")); void load(); return; }
          onOpen(result.document, source.sectionId);
        } catch { toast.error(t("loadFailed")); }
      }}><BookOpen className="size-4" />{t("openDocument")}</Button>}
    </> : <p className="text-xs text-muted-foreground">{t("noSource")}</p>}
    {selected.type === "frame" && selected.source?.sectionId && <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" className="mt-0.5" checked={selected.source.syncHeading !== false} disabled={disabled} onChange={(event) => onChange({ ...selected.source!, syncHeading: event.target.checked })} />{t("syncHeading")}
    </label>}
    {!editing ? <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { setPageId(source?.pageId ?? ""); setSectionId(source?.sectionId ?? ""); setFilter(""); setEditing(true); }}>{source ? t("changeLink") : t("linkSection")}</Button>
      {source && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>{t("unlink")}</Button>}
      {selected.source !== undefined && selected.parentId && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(undefined)}>{t("useParent")}</Button>}
    </div> : <fieldset disabled={disabled} className="space-y-2">
      <input className="h-8 w-full rounded-md border px-2 text-sm" aria-label={t("findDocument")} placeholder={t("findDocument")} value={filter} onChange={(event) => setFilter(event.target.value)} />
      <label className="block text-xs">{t("document")}<select aria-label={t("document")} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={pageId} onChange={(event) => { setPageId(event.target.value); setSectionId(""); }}>
        <option value="">{t("chooseDocument")}</option>
        {documents.filter((item) => item.id === pageId || item.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <label className="block text-xs">{t("section")}<select aria-label={t("section")} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
        <option value="">{t("wholeDocument")}</option>
        {pickedDocument?.sections.map((item) => <option key={item.id} value={item.id}>{"— ".repeat(Math.max(0, item.level - 1))}{item.title || t("untitledSection")}</option>)}
      </select></label>
      <div className="flex gap-2"><Button size="sm" disabled={!pickedDocument || Boolean(sectionId && !pickedDocument.sections.some((item) => item.id === sectionId))} onClick={() => { onChange({ pageId, sectionId }); setEditing(false); }}>{t("saveLink")}</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("cancel")}</Button></div>
    </fieldset>}
    </>}
  </section>;
}
