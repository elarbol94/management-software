"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stepLabel, stepTarget } from "../lib/presentation";
import { formatElapsed, parsePresenterMessage, presenterChannelName } from "../lib/presenter";
import type { PresentationRecord } from "../presentation-queries";

/**
 * A second window a presenter keeps to themselves while the audience watches the player.
 * It never drives its own camera — it only mirrors the player's current step over
 * BroadcastChannel, and its prev/next buttons steer the player rather than itself.
 */
export function PresentationPresenterView({ presentation }: { presentation: PresentationRecord }) {
  const t = useTranslations("wiki");
  const { elements, steps } = presentation;
  const [index, setIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - start), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const channel = new BroadcastChannel(presenterChannelName(presentation.id));
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
  }, [presentation.id, steps.length]);

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
  const nextStep = steps[index + 1] ?? null;
  const nextTarget = nextStep ? stepTarget(nextStep, elements) : null;

  return (
    <div className="flex h-screen flex-col bg-background p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">{presentation.title}</p>
          <p className="text-xs text-muted-foreground">
            {steps.length ? `${index + 1} / ${steps.length}` : t("presentations.noSteps")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-sm tabular-nums text-muted-foreground" role="timer">
          <Clock className="size-4" />
          {formatElapsed(elapsedMs)}
        </div>
      </header>

      <main className="mt-6 flex min-h-0 flex-1 flex-col gap-6">
        <section className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card p-4">
          <h1 className="text-xl font-semibold">
            {currentTarget ? stepLabel(currentTarget, index) : t("presentations.missingStep")}
          </h1>
          <p className="mt-4 text-sm whitespace-pre-wrap text-muted-foreground">
            {currentStep?.notes || t("presentations.noNotes")}
          </p>
        </section>

        <section className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <span className="text-xs font-semibold tracking-wide uppercase">{t("presentations.nextStepPreview")}</span>
          <p className="mt-1">{nextTarget ? stepLabel(nextTarget, index + 1) : t("presentations.noNextStep")}</p>
        </section>
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
