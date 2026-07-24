"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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

export function EvidencePanel({ targetType, targetId, compact = false }: { targetType: EvidenceTargetType; targetId: string; compact?: boolean }) {
  const t = useTranslations("wiki"); const [linked, setLinked] = useState<EvidenceItem[]>([]); const [available, setAvailable] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true); const [open, setOpen] = useState(false); const [query, setQuery] = useState("");

  async function load(search = "") {
    setLoading(true); const response = await fetch(`/api/wiki/evidence?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}&q=${encodeURIComponent(search)}`);
    if (response.ok) { const body = await response.json() as { linked: EvidenceItem[]; available: EvidenceItem[] }; setLinked(body.linked); setAvailable(body.available); }
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    const url = "/api/wiki/evidence?targetType=" + targetType + "&targetId=" + encodeURIComponent(targetId) + "&q=";
    void fetch(url)
      .then((response) => response.ok ? response.json() as Promise<{ linked: EvidenceItem[]; available: EvidenceItem[] }> : null)
      .then((body) => { if (!cancelled && body) { setLinked(body.linked); setAvailable(body.available); setLoading(false); } });
    return () => { cancelled = true; };
  }, [targetId, targetType]);

  return <section className={compact ? "space-y-2" : "space-y-3 rounded-xl border bg-card p-4"}><div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-medium"><BookMarked className="size-4 text-indigo-500" />{t("linkedEvidence")}</h3><Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button type="button" size="sm" variant="outline"><Plus className="size-3.5" />{t("addEvidence")}</Button>} /><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{t("chooseEvidence")}</DialogTitle></DialogHeader><div className="flex gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query); }} placeholder={t("searchEvidence")} /><Button type="button" onClick={() => void load(query)}>{t("search")}</Button></div>{loading ? <Loader2 className="mx-auto my-8 size-6 animate-spin" /> : <div className="max-h-[28rem] space-y-2 overflow-y-auto">{available.filter((item) => !linked.some((current) => current.annotationId === item.id)).map((item) => <button key={item.id} type="button" className="block w-full rounded-lg border p-3 text-left hover:bg-accent" onClick={async () => { await linkPdfEvidence({ annotationId: item.id!, targetType, targetId }); await load(query); setOpen(false); }}><span className="text-sm font-medium">{item.label || item.sourceTitle} · {t("pageNumber", { page: item.pageNumber })}</span>{item.selectedText && <span className="mt-1 line-clamp-3 block text-xs italic text-muted-foreground">“{item.selectedText}”</span>}{item.note && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{item.note}</span>}</button>)}</div>}</DialogContent></Dialog></div>
    {loading && !linked.length ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : !linked.length ? <p className="text-xs text-muted-foreground">{t("noLinkedEvidence")}</p> : <div className="space-y-2">{linked.map((item) => <article key={item.linkId} className="group rounded-lg border p-2 text-xs" style={{ ...userMarkColorStyle(item.createdByMarkColor), borderLeftColor: "var(--user-mark-solid)", borderLeftWidth: 3 }}><div className="flex items-start gap-2"><div className="min-w-0 flex-1">{item.deletedAt ? <p className="text-muted-foreground">{t("removedEvidence")}</p> : <><Link href={`/wiki/sources/${item.sourceId}/read/${item.documentId}?page=${item.pageNumber}&annotation=${item.annotationId}`} className="font-medium hover:underline" style={{ color: "var(--user-mark-solid)" }}>{item.label || item.sourceTitle} · {t("pageNumber", { page: item.pageNumber })}<ExternalLink className="ml-1 inline size-3" /></Link>{item.selectedText && <blockquote className="mt-1 line-clamp-3 border-l-2 pl-2 italic" style={{ borderColor: "var(--user-mark-solid)", backgroundColor: "var(--user-mark-highlight)" }}>“{item.selectedText}”</blockquote>}{item.note && <p className="mt-1 text-muted-foreground">{item.note}</p>}</>}</div>{item.linkId && <Button type="button" size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={async () => { await unlinkPdfEvidence(item.linkId!); setLinked((items) => items.filter((current) => current.linkId !== item.linkId)); }}><X className="size-3" /></Button>}</div></article>)}</div>}
  </section>;
}
