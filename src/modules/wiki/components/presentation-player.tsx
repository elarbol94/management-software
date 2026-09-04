"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { ReactFlow, ReactFlowProvider, useReactFlow, type NodeMouseHandler } from "@xyflow/react";
import { ChevronLeft, ChevronRight, Maximize, Minimize, NotebookText, Pause, Play, Scan, Spotlight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PRESENTATION_CAMERA_PADDING,
  elementBounds,
  elementsWithinStep,
  presentationCameraEasingFns,
  resolveStepDuration,
  stepIndexForElement,
  stepTarget,
} from "../lib/presentation";
import { parsePresenterMessage, presenterChannelName } from "../lib/presenter";
import type { PresentationRecord } from "../presentation-queries";
import { elementsToNodes, presentationNodeTypes, type PresentationNode } from "./presentation-canvas";
import { PresentationFollowBadge, PresentationLiveControl, usePresentationFollower } from "./presentation-live";

/** Set when this player is a remote follower mirroring someone else's live session. */
type FollowSource = { code: string; hostName: string };

// How long a free pan/zoom gesture is left alone before the camera snaps back to the
// current step's framing. Short enough that the view doesn't stay adrift, long enough
// that a pause mid-gesture (lifting fingers to reposition) doesn't get cut off.
const GESTURE_SNAP_BACK_MS = 900;

// How long leaving the player waits for the live session to be stopped before it navigates
// anyway. A hung request must not trap the presenter in the player; if the cap wins, the
// session's own 45s heartbeat staleness is what ends it.
const LIVE_STOP_TIMEOUT_MS = 2_000;

function Player({ presentation, follow }: { presentation: PresentationRecord; follow?: FollowSource }) {
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

  // Presenter-side pinch/wheel zoom and free pan: ReactFlow's own pane already implements
  // the pointer/touch gesture handling (zoomOnPinch, zoomOnScroll, panOnDrag below), so the
  // only piece left to build is "snap back once the presenter lets go" — a short idle timer
  // armed on every real user-driven viewport change and cleared by the next step's flight.
  const snapBackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSnapBack = useCallback(() => {
    if (snapBackTimer.current) {
      clearTimeout(snapBackTimer.current);
      snapBackTimer.current = null;
    }
  }, []);
  const scheduleSnapBack = useCallback(() => {
    clearSnapBack();
    snapBackTimer.current = setTimeout(() => flyTo(index), GESTURE_SNAP_BACK_MS);
  }, [clearSnapBack, flyTo, index]);
  // An element click's own mouseup reaches the pane's onMoveEnd (with a populated event,
  // same as a real gesture) BEFORE the click's onNodeClick fires — @xyflow/system defers
  // that callback to a setTimeout(..., 0) queued during mouseup, which a same-task click
  // handler always runs ahead of. So a click can't clear a snap-back it hasn't armed yet;
  // it has to tell onGestureEnd to skip arming one at all, ordering-independent either way.
  const suppressSnapBack = useRef(false);
  // ReactFlow reports its own programmatic moves (flyTo/fitView) with a null event, and only
  // a real mouse/touch/wheel interaction with a populated one — exactly the distinction
  // needed to tell "the presenter is gesturing" from "we just flew the camera ourselves".
  const onGestureStart = useCallback(
    (event: MouseEvent | TouchEvent | null) => {
      if (event) {
        // Ctrl+click never starts a d3 gesture (createFilter rejects ctrlKey mousedowns), so
        // onMoveEnd never fires to consume a suppression flag set by that same click's
        // onNodeClick — left true, it would swallow the *next* real gesture's snap-back.
        // move-start always precedes node-click, so clearing it here is ordering-safe.
        suppressSnapBack.current = false;
        clearSnapBack();
      }
    },
    [clearSnapBack],
  );
  const onGestureEnd = useCallback(
    (event: MouseEvent | TouchEvent | null) => {
      if (!event) return;
      if (suppressSnapBack.current) {
        suppressSnapBack.current = false;
        return;
      }
      scheduleSnapBack();
    },
    [scheduleSnapBack],
  );
  // A step change already re-frames the camera (the flyTo effect below); any snap-back
  // still pending from a gesture on the previous step would otherwise fire later and fly
  // to a stale index.
  useEffect(() => clearSnapBack, [index, clearSnapBack]);

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

  // A follower's camera belongs to the presenter, so every local way to move — clicking the
  // canvas, the arrow keys, the control bar — routes through here and does nothing.
  const following = Boolean(follow);
  const move = useCallback(
    (delta: number) => {
      if (following) return;
      setIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(steps.length - 1, 0)));
    },
    [following, steps.length],
  );

  // The Prezi "click anything, you're there" jump: an element that some step targets goes
  // through the normal setIndex path (status, notes, live broadcast, camera all follow); an
  // element no step targets just gets a free fly, leaving the step index untouched.
  const onElementClick = useCallback<NodeMouseHandler<PresentationNode>>(
    (event, node) => {
      // Never also register as the container's "click empty canvas" advance.
      event.stopPropagation();
      if (following) return;
      // The pane's own onMoveEnd (populated event, same as any real gesture) still fires for
      // this same click's mouseup, and it fires AFTER this handler — @xyflow/system defers it
      // to a setTimeout(..., 0) queued during mouseup, which this same-task click handler runs
      // ahead of. Clearing snapBackTimer here would be clearing a timer that doesn't exist yet;
      // flip a flag instead, for onGestureEnd to consume whenever it does run.
      suppressSnapBack.current = true;
      setPlaying(false);
      const target = node.data.element;
      const matchedIndex = stepIndexForElement(steps, target.id);
      if (matchedIndex !== null) {
        setIndex(matchedIndex);
        // Explicit, not left to the index-driven effect: clicking the CURRENT step's element
        // leaves index unchanged, so that effect would never re-run and the click would do
        // nothing visible.
        flyTo(matchedIndex);
        return;
      }
      void reactFlow.fitBounds(elementBounds(target), {
        padding: PRESENTATION_CAMERA_PADDING,
        duration: cameraDuration,
        ease: cameraEase,
      });
    },
    [following, steps, flyTo, reactFlow, cameraDuration, cameraEase],
  );

  // Remote follow (polled live session); the presenter-notes window keeps its own
  // BroadcastChannel path below untouched.
  const applyRemoteStep = useCallback(
    (stepIndex: number) => setIndex(Math.min(Math.max(stepIndex, 0), Math.max(steps.length - 1, 0))),
    [steps.length],
  );
  const remoteLive = usePresentationFollower(follow?.code ?? null, applyRemoteStep);

  // Kept current without being an effect dependency, so the channel below is set up once
  // and can still answer a presenter window's "where are we" with the latest step.
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const channelRef = useRef<BroadcastChannel | null>(null);

  // Presenter windows follow this player over BroadcastChannel: it broadcasts its own step
  // changes, and applies "goto" from a presenter window steering it back.
  useEffect(() => {
    const channel = new BroadcastChannel(presenterChannelName(presentation.id));
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const message = parsePresenterMessage(event.data);
      if (!message) return;
      if (message.type === "goto") {
        setIndex(Math.min(Math.max(message.index, 0), Math.max(steps.length - 1, 0)));
      } else if (message.type === "request-step") {
        channel.postMessage({ type: "step", index: indexRef.current });
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [presentation.id, steps.length]);

  useEffect(() => {
    channelRef.current?.postMessage({ type: "step", index });
  }, [index]);

  // Leaving the player must end the live session BEFORE navigating: Next posts server
  // actions to the current document URL, and the editor this pushes to does not register
  // the live-stop action, so a stop sent after the push is answered 200 and dropped on the
  // floor. Browser-back and closing the tab cannot run this and stay on the session's own
  // 45s heartbeat staleness fallback.
  const stopLive = useRef<(() => Promise<void>) | null>(null);
  const exitPresent = useCallback(async () => {
    await Promise.race([
      stopLive.current?.() ?? Promise.resolve(),
      new Promise<void>((resolve) => setTimeout(resolve, LIVE_STOP_TIMEOUT_MS)),
    ]);
    router.push(`/wiki/presentations/${presentation.id}`);
  }, [presentation.id, router]);

  const openPresenterView = useCallback(() => {
    window.open(
      `/wiki/presentations/${presentation.id}/present/notes`,
      `presenter-${presentation.id}`,
      "width=960,height=680",
    );
  }, [presentation.id]);

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
      } else if (event.key === "Home" && !following) {
        // Followers are excluded: an overview here would stick until the presenter
        // happens to change step, since the poll only re-frames on a new step.
        event.preventDefault();
        overview();
      } else if (event.key === "Escape" && !document.fullscreenElement) {
        // A follower has no business in the editor -- they were handed a code, not the
        // presentation. Send them back to the join screen, same as the badge's exit link,
        // and with no stop: the session is the presenter's, not theirs.
        if (following) router.push("/wiki/presentations/follow");
        else void exitPresent();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitPresent, following, move, overview, router]);

  // Its own listener, kept separate from the step-navigation one above: zoom is
  // presenter-local camera state, unrelated to whichever step index is currently shown.
  useEffect(() => {
    const onZoomKeyDown = (event: KeyboardEvent) => {
      if (!["+", "=", "-", "_"].includes(event.key)) return;
      event.preventDefault();
      const zooming = event.key === "-" || event.key === "_" ? reactFlow.zoomOut : reactFlow.zoomIn;
      void zooming({ duration: 150 });
      scheduleSnapBack();
    };
    window.addEventListener("keydown", onZoomKeyDown);
    return () => window.removeEventListener("keydown", onZoomKeyDown);
  }, [reactFlow, scheduleSnapBack]);

  // Spotlight/laser-pointer overlay: a presenter toggle, purely cosmetic. The pointer
  // position is written straight to the overlay's own CSS variables instead of React state
  // so mouse movement never triggers a render.
  const [spotlight, setSpotlight] = useState(false);
  const spotlightRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!spotlight) return;
    const onPointerMove = (event: PointerEvent) => {
      spotlightRef.current?.style.setProperty("--spotlight-x", `${event.clientX}px`);
      spotlightRef.current?.style.setProperty("--spotlight-y", `${event.clientY}px`);
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [spotlight]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void containerRef.current?.requestFullscreen();
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="presentation-player"
      // Covers the wiki rail and the app chrome: presenting owns the whole viewport.
      className="fixed inset-0 z-50 bg-background"
      style={presentation.background ? { backgroundColor: presentation.background } : undefined}
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
        // Nodes stay unselectable/undraggable above; passing onNodeClick alone is what makes
        // them clickable at all (ReactFlow otherwise sets pointer-events: none on them).
        onNodeClick={onElementClick}
        // Free camera while presenting: drag to pan, wheel/pinch to zoom, both bounded by
        // minZoom/maxZoom above. onMoveStart/onMoveEnd arm the snap-back defined earlier —
        // ReactFlow itself already tells apart a real gesture from our own flyTo calls.
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        onMoveStart={onGestureStart}
        onMoveEnd={onGestureEnd}
        preventScrolling
        proOptions={{ hideAttribution: false }}
      />

      {spotlight && (
        <div
          ref={spotlightRef}
          aria-hidden
          className="pointer-events-none fixed inset-0 z-40"
          style={{
            background:
              "radial-gradient(circle 180px at var(--spotlight-x, 50%) var(--spotlight-y, 50%), transparent 0%, transparent 55%, rgb(0 0 0 / 0.55) 100%)",
          }}
        >
          <div
            className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_14px_4px_rgba(239,68,68,0.85)]"
            style={{ left: "var(--spotlight-x, 50%)", top: "var(--spotlight-y, 50%)" }}
          />
        </div>
      )}

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

      {following && <PresentationFollowBadge live={remoteLive} hostName={follow?.hostName ?? ""} />}

      {!following && (
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
          <Button
            type="button"
            variant={spotlight ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={t("presentations.spotlight")}
            aria-pressed={spotlight}
            onClick={() => setSpotlight((current) => !current)}
          >
            <Spotlight className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.fullscreen")} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.openPresenterView")} onClick={openPresenterView}>
            <NotebookText className="size-4" />
          </Button>
          <PresentationLiveControl presentationId={presentation.id} stepIndex={index} stopRef={stopLive} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("presentations.exitPresent")}
            onClick={() => void exitPresent()}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

export function PresentationPlayer({
  presentation,
  follow,
}: {
  presentation: PresentationRecord;
  follow?: FollowSource;
}) {
  return (
    <ReactFlowProvider>
      <Player presentation={presentation} follow={follow} />
    </ReactFlowProvider>
  );
}
