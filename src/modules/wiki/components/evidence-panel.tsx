"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { BookMarked, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { EvidenceTargetType } from "../lib/pdf-evidence";
import { linkPdfEvidence, unlinkPdfEvidence } from "../pdf-actions";
import { userMarkColorStyle, type UserMarkColor } from "@/lib/user-mark-colors";

type EvidenceItem = {
  linkId?: string; id?: string; annotationId?: string; sourceId: string; documentId: string; pageNumber: number;
  kind: string; selectedText: string; note: string; label: string; color?: string; createdByMarkColor: UserMarkColor; sourceTitle: string; deletedAt?: string | null;
};

type EvidencePanelProps = { targetType: EvidenceTargetType; targetId: string; compact?: boolean };

export function EvidencePanel(props: EvidencePanelProps) {
  return <EvidencePanelContent key={`${props.targetType}:${props.targetId}`} {...props} />;
}

function EvidencePanelContent({ targetType, targetId, compact = false }: EvidencePanelProps) {
  const t = useTranslations("wiki"); const locale = useLocale(); const de = locale !== "en"; const [linked, setLinked] = useState<EvidenceItem[]>([]); const [available, setAvailable] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const [linkingId, setLinkingId] = useState(""); const [removingId, setRemovingId] = useState("");
  const targetKey = `${targetType}:${targetId}`;
  const mounted = useRef(true);
  const loadRequest = useRef(0);

  async function load(search = "", requestedTarget = targetKey) {
    if (!mounted.current || requestedTarget !== targetKey) return;
    const request = ++loadRequest.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/wiki/evidence?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}&q=${encodeURIComponent(search)}`);
      if (!response.ok) throw new Error("Evidence request failed");
      const body = await response.json() as { linked: EvidenceItem[]; available: EvidenceItem[] };
      if (request === loadRequest.current && mounted.current) {
        setLinked(body.linked); setAvailable(body.available);
      }
    } catch {
      if (request === loadRequest.current && mounted.current) {
        setLinked([]);
        setAvailable([]);
        setError(de ? "PDF-Nachweise konnten nicht geladen werden." : "PDF evidence could not be loaded.");
      }
    } finally {
      if (request === loadRequest.current && mounted.current) {
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const requestedTarget = targetKey;
    const request = ++loadRequest.current;
    const url = "/api/wiki/evidence?targetType=" + targetType + "&targetId=" + encodeURIComponent(targetId) + "&q=";
    void fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("Evidence request failed");
        return response.json() as Promise<{ linked: EvidenceItem[]; available: EvidenceItem[] }>;
      })
      .then((body) => {
        if (request === loadRequest.current && requestedTarget === targetKey && mounted.current) {
          setLinked(body.linked);
          setAvailable(body.available);
        }
      })
      .catch(() => {
        if (request === loadRequest.current && requestedTarget === targetKey && mounted.current) {
          setError(de ? "PDF-Nachweise konnten nicht geladen werden." : "PDF evidence could not be loaded.");
        }
      })
      .finally(() => {
        if (request === loadRequest.current && requestedTarget === targetKey && mounted.current) {
          setLoading(false);
        }
      });
    return () => {
      if (request === loadRequest.current) loadRequest.current += 1;
    };
  }, [de, targetId, targetKey, targetType]);

  const availableToLink = available.filter(
    (item) => !linked.some((current) => current.annotationId === item.id),
  );

  async function addEvidence(item: EvidenceItem) {
    const mutationTarget = targetKey;
    if (!item.id) return;
    setLinkingId(item.id);
    setError("");
    try {
      await linkPdfEvidence({ annotationId: item.id, targetType, targetId });
      if (!mounted.current || mutationTarget !== targetKey) return;
      await load(query, mutationTarget);
      if (mounted.current && mutationTarget === targetKey) setOpen(false);
    } catch {
      if (mounted.current && mutationTarget === targetKey) {
        setError(de ? "Der PDF-Nachweis konnte nicht verknüpft werden." : "The PDF evidence could not be linked.");
      }
    } finally {
      if (mounted.current && mutationTarget === targetKey) setLinkingId("");
    }
  }

  async function removeEvidence(item: EvidenceItem) {
    const mutationTarget = targetKey;
    if (!item.linkId) return;
    setRemovingId(item.linkId);
    setError("");
    try {
      await unlinkPdfEvidence(item.linkId);
      if (!mounted.current || mutationTarget !== targetKey) return;
      setLinked((items) => items.filter((current) => current.linkId !== item.linkId));
    } catch {
      if (mounted.current && mutationTarget === targetKey) {
        setError(de ? "Der PDF-Nachweis konnte nicht entfernt werden." : "The PDF evidence could not be removed.");
      }
    } finally {
      if (mounted.current && mutationTarget === targetKey) setRemovingId("");
    }
  }

  return <section className={compact ? "space-y-2" : "space-y-3 rounded-xl border bg-card p-4"}><div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-medium"><BookMarked className="size-4 text-indigo-500" />{t("linkedEvidence")}</h3><Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) void load(query); }}><DialogTrigger render={<Button type="button" size="sm" variant="outline"><Plus className="size-3.5" />{t("addEvidence")}</Button>} /><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{t("chooseEvidence")}</DialogTitle></DialogHeader><div className="flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query); }} placeholder={t("searchEvidence")} /><Button type="button" disabled={loading} onClick={() => void load(query)}>{t("search")}</Button></div>{loading ? <Loader2 className="mx-auto my-8 size-6 animate-spin" /> : error ? <p role="alert" className="py-8 text-center text-sm text-destructive">{error}</p> : availableToLink.length ? <div className="max-h-[28rem] space-y-2 overflow-y-auto">{availableToLink.map((item) => <button key={item.id} type="button" disabled={linkingId === item.id} className="block w-full rounded-lg border p-3 text-left hover:bg-accent disabled:opacity-60" onClick={() => void addEvidence(item)}><span className="text-sm font-medium">{item.label || item.sourceTitle} · {t("pageNumber", { page: item.pageNumber })}</span>{item.selectedText && <span className="mt-1 line-clamp-3 block text-xs italic text-muted-foreground">“{item.selectedText}”</span>}{item.note && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{item.note}</span>}</button>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">{t("noEvidenceAvailable")}</p>}</DialogContent></Dialog></div>
    {error && !open && <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"><span>{error}</span><Button type="button" size="xs" variant="outline" onClick={() => void load()}>{t("retry")}</Button></div>}
    {loading && !linked.length ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : !linked.length ? <p className="text-xs text-muted-foreground">{t("noLinkedEvidence")}</p> : <div className="space-y-2">{linked.map((item) => <article key={item.linkId} className="group rounded-lg border p-2 text-xs" style={{ ...userMarkColorStyle(item.createdByMarkColor), borderLeftColor: "var(--user-mark-solid)", borderLeftWidth: 3 }}><div className="flex items-start gap-2"><div className="min-w-0 flex-1">{item.deletedAt ? <p className="text-muted-foreground">{t("removedEvidence")}</p> : <><Link href={`/wiki/sources/${item.sourceId}/read/${item.documentId}?page=${item.pageNumber}&annotation=${item.annotationId}`} className="font-medium hover:underline" style={{ color: "var(--user-mark-solid)" }}>{item.label || item.sourceTitle} · {t("pageNumber", { page: item.pageNumber })}<ExternalLink className="ml-1 inline size-3" /></Link>{item.selectedText && <blockquote className="mt-1 line-clamp-3 border-l-2 pl-2 italic" style={{ borderColor: "var(--user-mark-solid)", backgroundColor: "var(--user-mark-highlight)" }}>“{item.selectedText}”</blockquote>}{item.note && <p className="mt-1 text-muted-foreground">{item.note}</p>}</>}</div>{item.linkId && <Button type="button" size="icon-xs" variant="ghost" aria-label={de ? "PDF-Nachweis entfernen" : "Remove PDF evidence"} disabled={removingId === item.linkId} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void removeEvidence(item)}><X className="size-3" /></Button>}</div></article>)}</div>}
  </section>;
}
