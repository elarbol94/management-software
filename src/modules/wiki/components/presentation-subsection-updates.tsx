"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { defaultPresentationSettings, stepLabel, type PresentationElement } from "../lib/presentation";
import { presentationValuesEqual } from "../lib/presentation-merge";
import { presentationSubsectionProposals, type SubsectionProposal } from "../lib/presentation-subsections";
import { sourceKey, type PresentationSourcePreview } from "../lib/presentation-source";
import type { PresentationSourcePreviewsState } from "./use-presentation-source-previews";
import { PresentationScene } from "./presentation-scene";

type Review = { expected: PresentationElement[]; proposal: SubsectionProposal };
export function PresentationSubsectionUpdates({ elements, previews, disabled, busy, onApply, onUndo, onShow, onReviewOpen, undoElements }: {
  elements: PresentationElement[]; previews: PresentationSourcePreviewsState; disabled: boolean; busy: boolean;
  onApply: (expected: PresentationElement[], proposal: SubsectionProposal) => boolean;
  undoElements?: PresentationElement[];
  onReviewOpen: () => void;
  onUndo: () => void; onShow: (id: string) => void;
}) {
  const t = useTranslations("documentPresentationLinks");
  const proposals = useMemo(() => presentationSubsectionProposals(elements, previews.previews), [elements, previews.previews]);
  const [notice, setNotice] = useState<SubsectionProposal | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<"structureStale" | "previewFailed" | null>(null);
  const latest = useRef({ elements, disabled, busy, onApply });
  const request = useRef(0);
  const pointerDown = useRef(false);
  useLayoutEffect(() => { latest.current = { elements, disabled, busy, onApply }; }, [elements, disabled, busy, onApply]);
  useLayoutEffect(() => () => { request.current++; }, []);
  useEffect(() => {
    const down = () => { pointerDown.current = true; };
    const up = () => { pointerDown.current = false; };
    document.addEventListener("pointerdown", down); window.addEventListener("pointerup", up); window.addEventListener("blur", up);
    return () => { document.removeEventListener("pointerdown", down); window.removeEventListener("pointerup", up); window.removeEventListener("blur", up); };
  }, []);
  useEffect(() => {
    const proposal = proposals.find((item) => !item.issue && !item.requiresReview);
    if (!proposal || disabled || busy || review || previews.error || previews.loading) return;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const current = latest.current;
        // Let typing, canvas gestures and dialogs finish. No blur or camera change.
        if (current.disabled || current.busy || pointerDown.current || document.visibilityState === "hidden" || [...document.querySelectorAll('[role="dialog"]')].some((dialog) => dialog.getClientRects().length > 0) || document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
        if (!presentationValuesEqual(current.elements, elements)) return;
        if (current.onApply(elements, proposal)) setNotice(proposal);
      }, 150);
    };
    schedule(); document.addEventListener("focusout", schedule); window.addEventListener("pointerup", schedule); document.addEventListener("visibilitychange", schedule);
    return () => { window.clearTimeout(timer); document.removeEventListener("focusout", schedule); window.removeEventListener("pointerup", schedule); document.removeEventListener("visibilitychange", schedule); };
  }, [elements, proposals, disabled, busy, review, previews.error, previews.loading]);
  const label = (id: string, list = elements) => { const index = list.findIndex((element) => element.id === id); return index < 0 ? "" : stepLabel(list[index], index); };
  const close = () => { request.current++; setReview(null); setChecking(false); setMessage(null); };
  async function apply() {
    if (!review || latest.current.disabled || latest.current.busy || checking) return;
    const version = ++request.current;
    setChecking(true); setMessage(null);
    try {
      const sources = [...new Map(latest.current.elements.filter((element) => element.source).map((element) => [sourceKey(element.source!), { pageId: element.source!.pageId, sectionId: element.source!.sectionId }])).values()];
      const response = await fetch("/api/wiki/presentation-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources }), cache: "no-store" });
      if (!response.ok) throw new Error();
      const result: { previews: PresentationSourcePreview[] } = await response.json();
      if (request.current !== version) return;
      const current = latest.current;
      const fresh = new Map(result.previews.map((preview) => [sourceKey(preview), preview]));
      const proposal = presentationSubsectionProposals(current.elements, fresh).find((item) => item.parentId === review.proposal.parentId);
      if (!proposal) { close(); previews.refresh(); return; }
      if (!presentationValuesEqual(current.elements, review.expected) || !presentationValuesEqual(proposal, review.proposal)) {
        setReview({ expected: current.elements, proposal }); setMessage("structureStale"); return;
      }
      if (current.disabled || current.busy || proposal.issue) return;
      if (current.onApply(current.elements, proposal)) setNotice(proposal);
      close(); previews.refresh();
    } catch { if (request.current === version) setMessage("previewFailed"); }
    finally { if (request.current === version) setChecking(false); }
  }
  const pending = proposals.filter((proposal) => proposal.issue || proposal.requiresReview);
  const visibleNotice = notice && notice.addedIds.some((id) => elements.some((element) => element.id === id));
  return <>
    {visibleNotice && <div className="flex flex-wrap items-center gap-2 border-b bg-indigo-50 px-4 py-2 text-xs text-indigo-950 dark:bg-indigo-950/30 dark:text-indigo-100" data-testid="subsection-added">
      <Check className="size-3.5 shrink-0" /><span role="status" className="min-w-0 flex-1">{t("subsectionsAdded", { count: notice.addedIds.length, parent: label(notice.parentId) })}</span>
      <Button size="sm" variant="ghost" onClick={() => onShow(notice.addedIds.find((id) => elements.some((element) => element.id === id))!)}>{t("subsectionsShow")}</Button>
      {undoElements && notice.addedIds.every((id) => !undoElements.some((element) => element.id === id)) && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { onUndo(); setNotice(null); }}>{t("subsectionsUndo")}</Button>}
      <Button size="icon-sm" variant="ghost" aria-label={t("subsectionsDismiss")} onClick={() => setNotice(null)}><X className="size-3.5" /></Button>
    </div>}
    {pending.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-4 py-2 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" data-testid="subsection-pending">
      <span role="status">{t("subsectionsPending", { count: pending.length })}</span>
      {pending.map((proposal) => <Button size="sm" variant="ghost" key={proposal.parentId} disabled={previews.error || previews.loading} onClick={() => { onReviewOpen(); setReview({ expected: elements, proposal }); setMessage(null); }}>{t("subsectionsReview")} · {label(proposal.parentId)}</Button>)}
    </div>}
    <Dialog open={Boolean(review)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>{t("subsectionsReview")}</DialogTitle><DialogDescription>{t("subsectionsReviewHint")}</DialogDescription></DialogHeader>
        {review && <div className="max-h-[65vh] space-y-3 overflow-y-auto">
          <p className="text-sm font-medium">{label(review.proposal.parentId, review.expected)}</p>
          {review.proposal.issue ? <p role="alert" className="text-sm text-destructive">{t(review.proposal.issue)}</p> : <>
            <div className="grid gap-3 sm:grid-cols-2">{[{ title: t("subsectionsBefore"), elements: review.expected }, { title: t("subsectionsAfter"), elements: review.proposal.elements }].map((preview) => <figure key={preview.title}>
              <figcaption className="mb-1 text-xs text-muted-foreground">{preview.title}</figcaption>
              <div className="pointer-events-none aspect-video overflow-hidden rounded-md border" inert><PresentationScene presentation={{ elements: preview.elements, steps: [], title: preview.title, background: "", settings: defaultPresentationSettings }} index={0} interactive={false} /></div>
            </figure>)}</div>
            <ul className="list-inside list-disc text-sm">{review.proposal.addedIds.map((id) => <li key={id}>{label(id, review.proposal.elements)}</li>)}</ul>
            {review.proposal.movedIds.length > 0 && <p className="text-xs text-muted-foreground">{t("subsectionsMoving", { frames: review.proposal.movedIds.filter((id) => review.expected.find((element) => element.id === id)?.type === "frame").map((id) => label(id, review.expected)).join(", ") })}</p>}
          </>}
          {message && <p role="status" className="text-sm">{t(message)}</p>}
        </div>}
        <DialogFooter><Button variant="ghost" onClick={close}>{t("structureLater")}</Button><Button disabled={disabled || busy || checking || Boolean(review?.proposal.issue)} onClick={() => void apply()}>{checking ? t("checkingSources") : t("subsectionsApply")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
