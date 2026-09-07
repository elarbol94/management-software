"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { stepLabel, type PresentationElement } from "../lib/presentation";
import { sourceKey, type PresentationSourcePreview } from "../lib/presentation-source";
import { presentationStructureProposals, structureReviewKey, type StructureProposal } from "../lib/presentation-structure";
import type { PresentationSourcePreviewsState } from "./use-presentation-source-previews";

type Review = { elements: PresentationElement[]; previews: ReadonlyMap<string, PresentationSourcePreview>; proposal: StructureProposal; key: string };
export function PresentationStructureReview({ elements, previews, disabled, onApply }: {
  elements: PresentationElement[]; previews: PresentationSourcePreviewsState; disabled: boolean;
  onApply: (expected: PresentationElement[], proposal: StructureProposal) => void;
}) {
  const t = useTranslations("documentPresentationLinks");
  const proposals = useMemo(() => presentationStructureProposals(elements, previews.previews), [elements, previews.previews]);
  const [review, setReview] = useState<Review | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<"structureStale" | "previewFailed" | null>(null);
  const latest = useRef({ elements, disabled, onApply });
  const request = useRef(0);
  useLayoutEffect(() => { latest.current = { elements, disabled, onApply }; }, [elements, disabled, onApply]);
  useLayoutEffect(() => () => { request.current++; }, []);
  const close = () => { request.current++; setReview(null); setChecking(false); setMessage(null); };
  const label = (id: string | undefined, list = review?.elements ?? elements) => {
    const index = list.findIndex((e) => e.id === id);
    return index < 0 ? t("structureRoot") : stepLabel(list[index], index);
  };
  const start = (proposal: StructureProposal) => {
    setMessage(null);
    setReview({ elements, previews: previews.previews, proposal, key: structureReviewKey(elements, previews.previews) });
  };
  async function apply() {
    if (!review || latest.current.disabled || checking) return;
    const version = ++request.current;
    setChecking(true); setMessage(null);
    try {
      const sources = [...new Map(latest.current.elements.filter((e) => e.type === "frame" && e.source?.sectionId).map((e) => [sourceKey(e.source!), { pageId: e.source!.pageId, sectionId: e.source!.sectionId }])).values()];
      const response = await fetch("/api/wiki/presentation-sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources }), cache: "no-store" });
      if (!response.ok) throw new Error();
      const result: { previews: PresentationSourcePreview[] } = await response.json();
      if (request.current !== version) return;
      const fresh = new Map(result.previews.map((p) => [sourceKey(p), p]));
      const current = latest.current;
      const key = structureReviewKey(current.elements, fresh);
      const proposal = presentationStructureProposals(current.elements, fresh).find((p) => p.changes.some((c) => review.proposal.changes.some((old) => old.elementId === c.elementId)));
      if (key !== review.key || !proposal) {
        if (proposal) setReview({ elements: current.elements, previews: fresh, proposal, key });
        else { setReview(null); previews.refresh(); }
        setMessage("structureStale");
        return;
      }
      if (current.disabled || proposal.issues.length) return;
      current.onApply(current.elements, proposal);
      close(); previews.refresh();
    } catch { if (request.current === version) setMessage("previewFailed"); }
    finally { if (request.current === version) setChecking(false); }
  }
  return <div className="space-y-2">
    {proposals.length > 0 && <div className="space-y-1 border-b pb-2">
      <p className="text-xs font-medium">{t("structurePending", { count: proposals.length })}</p>
      {proposals.map((proposal) => <Button key={proposal.id} variant="outline" size="sm" className="h-auto w-full whitespace-normal text-left" disabled={previews.error || previews.loading} onClick={() => start(proposal)}>{t("reviewStructure")} · {label(proposal.changes[0].elementId, elements)}</Button>)}
    </div>}
    {message && !review && <p role="status" className="text-xs">{t(message)}</p>}
    <Dialog open={Boolean(review)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{t("reviewStructure")}</DialogTitle><DialogDescription>{t("structureHint")}</DialogDescription></DialogHeader>
        {review && <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          <ul className="space-y-3">{review.proposal.changes.map((change) => {
            const frame = review.elements.find((e) => e.id === change.elementId)!;
            const target = change.after.parentSectionId;
            const sourcePreview = review.previews.get(sourceKey(frame.source!));
            const parentPreview = target ? review.previews.get(sourceKey({ pageId: frame.source!.pageId, sectionId: target })) : undefined;
            const newParent = change.newParentId ? label(change.newParentId) : target ? sourcePreview?.snapshot?.headingParentTitle ?? parentPreview?.snapshot?.headingTitle ?? t("structureUnlinkedParent") : t("structureRoot");
            return <li key={change.elementId} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{label(change.elementId)}</p>
              <p>{t("structureLevel", { before: change.before ? "#".repeat(change.before.level) : t("structureUnknown"), after: "#".repeat(change.after.level) })}</p>
              <p>{t("structureParent", { before: label(change.oldParentId), after: newParent })}</p>
            </li>;
          })}</ul>
          <p className="text-sm font-medium">{t("structureAffected")}</p>
          <ul className="list-inside list-disc text-sm">{review.proposal.affectedIds.map((id) => <li key={id}>{label(id)}</li>)}</ul>
          {review.proposal.issues.map((issue) => <p key={`${issue.kind}:${issue.elementId}`} role="alert" className="text-sm text-destructive">{t(issue.kind, { frame: label(issue.elementId) })}</p>)}
          {message && <p role="status" className="text-sm">{t(message)}</p>}
        </div>}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>{t("structureLater")}</Button>
          <Button disabled={disabled || checking || Boolean(review?.proposal.issues.length)} onClick={() => void apply()}>{checking ? t("checkingSources") : t("applyStructure")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
