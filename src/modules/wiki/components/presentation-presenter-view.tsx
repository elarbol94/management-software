"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PresentationScene } from "./presentation-scene";
import { documentSectionHref, presentationSource } from "../lib/presentation-source";
import { stepLabel, stepTarget } from "../lib/presentation";
import { formatElapsed, parsePresenterMessage, presenterChannelName } from "../lib/presenter";
import type { PresentationRecord } from "../presentation-queries";

const subscribeHydration = () => () => {};

/**
 * A second window a presenter keeps to themselves while the audience watches the player.
 * It never drives its own camera — it only mirrors the player's current step over
 * BroadcastChannel, and its prev/next buttons steer the player rather than itself.
 */
export function PresentationPresenterView({ presentation, sessionId }: { presentation: PresentationRecord; sessionId?: string }) {
  const t = useTranslations("wiki");
  const studio = useTranslations("presentationStudio");
  const linkText = useTranslations("documentPresentationLinks");
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const { elements, steps } = presentation;
  const [index, setIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedNotes, setSavedNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!running) return;
    let previous = Date.now();
    const timer = setInterval(() => { const now = Date.now(); setElapsedMs((elapsed) => elapsed + now - previous); previous = now; }, 250);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(presenterChannelName(presentation.id, sessionId));
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const message = parsePresenterMessage(event.data);
      if (message?.type === "step") {
        setIndex(Math.min(Math.max(message.index, 0), Math.max(steps.length - 1, 0)));
      }
    };
    // The player may already be several steps in by the time this window opens.
    channel.postMessage({ type: "request-step" });
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [presentation.id, sessionId, steps.length]);

  const goTo = useCallback(
    (nextIndex: number) => {
      const clamped = Math.min(Math.max(nextIndex, 0), Math.max(steps.length - 1, 0));
      setIndex(clamped);
      channelRef.current?.postMessage({ type: "goto", index: clamped });
    },
    [steps.length],
  );

  const currentStep = steps[index] ?? null;
  const currentTarget = currentStep ? stepTarget(currentStep, elements) : null;
  const source = currentTarget ? presentationSource(elements, currentTarget.id) : null;
  async function openSource() {
    if (!source) return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) { toast.error(t("presentations.popupBlocked")); return; }
    try {
      const response = await fetch(`/api/wiki/presentation-sources?source=${encodeURIComponent(source.pageId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!result.document) { tab.close(); toast.error(linkText("missingSource")); return; }
      tab.opener = null;
      tab.location.href = documentSectionHref(result.document.slug, source.sectionId);
    } catch { tab.close(); toast.error(linkText("loadFailed")); }
  }
  const nextStep = steps[index + 1] ?? null;
  const nextTarget = nextStep ? stepTarget(nextStep, elements) : null;
  const notesValue = currentStep ? drafts[currentStep.id] ?? savedNotes[currentStep.id] ?? currentStep.notes ?? "" : "";
  const saveNotes = async () => {
    if (!currentStep || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/wiki/presentations/${presentation.id}/studio`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notes", stepId: currentStep.id, notes: notesValue, previous: savedNotes[currentStep.id] ?? currentStep.notes ?? "" }) });
      if (!response.ok) throw new Error("Save failed");
      const result = await response.json();
      if (result.conflict) { toast.error(studio("notesConflict")); return; }
      setSavedNotes((notes) => ({ ...notes, [currentStep.id]: notesValue })); toast.success(studio("notesSaved"));
    } catch { toast.error(studio("operationFailed")); } finally { setSaving(false); }
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!steps.some((step) => drafts[step.id] !== undefined && drafts[step.id] !== (savedNotes[step.id] ?? step.notes ?? ""))) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [drafts, savedNotes, steps]);

  return (
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-background p-4 sm:p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">{presentation.title}</p>
          <p className="text-xs text-muted-foreground">
            {steps.length ? `${index + 1} / ${steps.length}` : t("presentations.noSteps")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
          <Clock className="size-4" />
          <span role="timer">{formatElapsed(elapsedMs)}</span>
          <Button type="button" size="sm" variant="outline" disabled={!hydrated} onClick={() => setRunning(!running)}>{running ? studio("pauseTimer") : studio("resumeTimer")}</Button>
          <Button type="button" size="sm" variant="outline" disabled={!hydrated} onClick={() => setElapsedMs(0)}>{studio("resetTimer")}</Button>
        </div>
      </header>

      <main className="mt-6 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="grid shrink-0 grid-cols-[2fr_1fr] gap-3 sm:gap-4">
          <section className="min-w-0"><h2 className="mb-2 text-sm font-medium">{studio("currentPreview")}</h2><div className="h-[22dvh] min-h-28 overflow-hidden rounded-md border sm:h-[32dvh]"><PresentationScene presentation={presentation} index={index} /></div></section>
          <section className="min-w-0"><h2 className="mb-2 text-sm font-medium">{studio("nextPreview")}</h2><div className="h-[22dvh] min-h-28 overflow-hidden rounded-md border sm:h-[32dvh]">{nextStep ? <PresentationScene presentation={presentation} index={index + 1} /> : <p className="p-4 text-sm text-muted-foreground">{t("presentations.noNextStep")}</p>}</div></section>
        </div>
        <section className="min-h-56 shrink-0 flex-1 rounded-lg border bg-card p-4">
          <h1 className="text-xl font-semibold">
            {currentTarget ? stepLabel(currentTarget, index) : t("presentations.missingStep")}
          </h1>
          {source && <Button size="sm" variant="outline" className="mt-2" onClick={() => void openSource()}>{linkText("presenterSource")}</Button>}
          {!currentStep && <p className="mt-4 text-sm text-muted-foreground">{t("presentations.noNotes")}</p>}
          {currentStep && <><textarea className="mt-3 min-h-28 w-full rounded-md border p-3 text-base" disabled={!hydrated} aria-label={t("presentations.speakerNotes")} value={notesValue} maxLength={5000} onChange={(event) => { const value = event.target.value; setDrafts((drafts) => ({ ...drafts, [currentStep.id]: value })); }} /><Button type="button" className="mt-2" size="sm" disabled={!hydrated || saving || notesValue === (savedNotes[currentStep.id] ?? currentStep.notes ?? "")} onClick={() => void saveNotes()}>{studio("saveNotes")}</Button></>}
        </section>

        {nextStep && <section className="shrink-0 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <span className="text-xs font-semibold tracking-wide uppercase">{t("presentations.nextStepPreview")}</span>
          <p className="mt-1">{nextTarget ? stepLabel(nextTarget, index + 1) : t("presentations.noNextStep")}</p>
        </section>}
      </main>

      <footer className="mt-6 flex items-center justify-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={index === 0} onClick={() => goTo(index - 1)}>
          <ChevronLeft className="size-4" />
          {t("presentations.previousStep")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={index >= steps.length - 1} onClick={() => goTo(index + 1)}>
          {t("presentations.nextStep")}
          <ChevronRight className="size-4" />
        </Button>
      </footer>
    </div>
  );
}
