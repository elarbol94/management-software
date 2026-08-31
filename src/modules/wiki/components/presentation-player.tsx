"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { ChevronLeft, ChevronRight, Maximize, Minimize, Pause, Play, Scan, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PRESENTATION_CAMERA_PADDING,
  elementBounds,
  elementsWithinStep,
  presentationCameraEasingFns,
  resolveStepDuration,
  stepTarget,
} from "../lib/presentation";
import type { PresentationRecord } from "../presentation-queries";
import { elementsToNodes, presentationNodeTypes, type PresentationNode } from "./presentation-canvas";

function Player({ presentation }: { presentation: PresentationRecord }) {
  const t = useTranslations("wiki");
  const router = useRouter();
  const reactFlow = useReactFlow<PresentationNode>();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [playing, setPlaying] = useState(false);

  const { elements, steps, settings } = presentation;
  const cameraDuration = settings.cameraTransitionMs;
  const cameraEase = presentationCameraEasingFns[settings.cameraEasing];

  // Elements that belong to the current step's target: what fades in as it arrives.
  // Derived straight from the index, so re-arriving at a step re-plays the entrance.
  const enteringIds = useMemo(() => {
    const step = steps[index];
    const target = step ? stepTarget(step, elements) : null;
    return target ? new Set(elementsWithinStep(target, elements).map((element) => element.id)) : new Set<string>();
  }, [index, steps, elements]);

  const nodes = useMemo(() => elementsToNodes(elements, { editable: false, enteringIds }), [elements, enteringIds]);

  const overview = useCallback(
    (duration = cameraDuration) => void reactFlow.fitView({ padding: 0.15, duration, ease: cameraEase }),
    [reactFlow, cameraDuration, cameraEase],
  );

  /**
   * Every step is framed by fitting its element's bounds, so a small frame nested inside
   * a large one zooms all the way in — the camera never inherits the previous scale.
   */
  const flyTo = useCallback(
    (stepIndex: number, duration = cameraDuration) => {
      const step = steps[stepIndex];
      const target = step ? stepTarget(step, elements) : null;
      if (!target) return overview(duration);
      void reactFlow.fitBounds(elementBounds(target), { padding: PRESENTATION_CAMERA_PADDING, duration, ease: cameraEase });
    },
    [elements, overview, reactFlow, steps, cameraDuration, cameraEase],
  );

  // Autoplay: advance to the next step after its effective duration elapses, looping
  // back to the start (or stopping) once the path runs out.
  useEffect(() => {
    if (!playing || !steps.length) return;
    const duration = resolveStepDuration(steps[index], settings);
    const timer = setTimeout(() => {
      setIndex((current) => {
        const next = current + 1;
        if (next < steps.length) return next;
        if (settings.loop) return 0;
        setPlaying(false);
        return current;
      });
    }, duration);
    return () => clearTimeout(timer);
  }, [playing, index, steps, settings]);

  const move = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(steps.length - 1, 0)));
    },
    [steps.length],
  );

  useEffect(() => {
    // A frame after paint, so the very first flight is measured against a pane that
    // already has its size rather than against a zero-sized one.
    const frame = requestAnimationFrame(() => flyTo(index));
    return () => cancelAnimationFrame(frame);
  }, [index, flyTo]);

  // Entering fullscreen or resizing changes what "fits" means, so the current step is
  // re-framed instantly rather than left half off-screen.
  useEffect(() => {
    const reframe = () => flyTo(index, 0);
    const onFullscreenChange = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      reframe();
    };
    window.addEventListener("resize", reframe);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("resize", reframe);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [flyTo, index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        overview();
      } else if (event.key === "Escape" && !document.fullscreenElement) {
        router.push(`/wiki/presentations/${presentation.id}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move, overview, presentation.id, router]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }, []);

  return (
    <div
      ref={containerRef}
      // Covers the wiki rail and the app chrome: presenting owns the whole viewport.
      className="fixed inset-0 z-50 bg-background"
      onClick={() => move(1)}
    >
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={presentationNodeTypes}
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.02}
        maxZoom={8}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling
        proOptions={{ hideAttribution: false }}
      />

      {playing && steps.length > 0 && (
        // Progress hint for the running step: a bar that fills over its effective duration.
        <div className="absolute inset-x-0 top-0 z-10 h-1 bg-foreground/10">
          <div
            key={`${index}-${playing}`}
            className="h-full origin-left bg-indigo-500"
            style={{ animation: `presentation-step-progress ${resolveStepDuration(steps[index], settings)}ms linear forwards` }}
          />
        </div>
      )}

      <div
        className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-1 rounded-full border bg-background/90 px-2 py-1 shadow-sm backdrop-blur">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? t("presentations.pause") : t("presentations.play")}
            disabled={!steps.length}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.previousStep")} disabled={index === 0} onClick={() => move(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center text-xs tabular-nums" role="status" aria-live="polite">
            {steps.length ? `${index + 1} / ${steps.length}` : t("presentations.noSteps")}
          </span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.nextStep")} disabled={index >= steps.length - 1} onClick={() => move(1)}>
            <ChevronRight className="size-4" />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.overview")} onClick={() => overview()}>
            <Scan className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.fullscreen")} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("presentations.exitPresent")}
            onClick={() => router.push(`/wiki/presentations/${presentation.id}`)}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PresentationPlayer({ presentation }: { presentation: PresentationRecord }) {
  return (
    <ReactFlowProvider>
      <Player presentation={presentation} />
    </ReactFlowProvider>
  );
}
