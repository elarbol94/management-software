"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BookOpen, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { presentationSource, type PresentationSource, type PresentationSourceDocument } from "../lib/presentation-source";
import type { PresentationElement } from "../lib/presentation";

export function PresentationSourcePanel({ elements, selected, disabled, onChange, onOpen }: {
  elements: PresentationElement[]; selected: PresentationElement | null; disabled: boolean;
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
  const source = selected ? presentationSource(elements, selected.id) : null;
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
  if (!selected) return null;
  const missing = loaded && source && (!document || (source.sectionId && !section));
  return <section className="mb-4 space-y-2 rounded-md border p-3" aria-label={t("source")}>
    <h2 className="flex items-center gap-2 text-sm font-medium"><Link2 className="size-4" />{t("source")}</h2>
    {error ? <Button size="sm" variant="outline" onClick={() => void load()}>{t("retry")}</Button> : !loaded ? <p className="text-xs text-muted-foreground">{t("loading")}</p> : source ? <>
      <p className="break-words text-xs text-muted-foreground">{document?.title}{section ? ` › ${section.title}` : ""}</p>
      {selected.source === undefined && <p className="text-xs text-muted-foreground">{t("inherited")}</p>}
      {missing && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("missingSource")}</p>}
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
  </section>;
}
