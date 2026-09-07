"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePresentationSourcePreviews } from "./use-presentation-source-previews";
import { applyStructureProposal } from "../lib/presentation-structure";
import { PresentationSourcePanel } from "./presentation-source-panel";
import { documentSectionHref, sourceKey, sourceReviewStatus, synchronizePresentationHeadings, preservePresentationHeadingOverride, type PresentationSourceDocument } from "../lib/presentation-source";
import { readLinkedPosition, rememberLinkedPosition } from "../lib/linked-navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { createId } from "@paralleldrive/cuid2";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useStore,
  useReactFlow,
  useViewport,
  type NodeChange,
} from "@xyflow/react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  Copy,
  FileDown,
  GripVertical,
  History,
  ImagePlus,
  Loader2,
  Lock,
  Maximize2,
  PanelRight,
  PanelLeft,
  MoreHorizontal,
  Share2,
  Play,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Settings,
  Shapes,
  Square,
  Target,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ColorPicker } from "@/components/ui/color-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { WorkspacePanel } from "./workspace-panel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  restorePresentationRevision,
  savePresentation,
} from "../presentation-actions";
import type { PresentationRecord, PresentationRevisionItem } from "../presentation-queries";
import {
  PRESENTATION_CAMERA_PADDING,
  PRESENTATION_SNAP_TOLERANCE,
  duplicatePresentationTree,
  presentationDescendants,
  presentationAncestors,
  isPresentationElementLocked,
  applyGeometryChanges,
  initialPresentationCanvasState,
  presentationCanvasReducer,
  presentationCameraBounds,
  parseSecondsInput,
  moveStep,
  presentationCameraEasings,
  presentationFrameShapes,
  presentationShapeKinds,
  reorderElement,
  retargetStep,
  rotateElements,
  scaleElements,
  stepLabel,
  stepTarget,
  unionBounds,
  type PresentationBounds,
  type PresentationCameraEasing,
  type PresentationCanvasState,
  type PresentationElement,
  type PresentationGeometryChange,
  type PresentationSettings,
  type PresentationStep,
  type SnapGuide,
} from "../lib/presentation";
import { elementsToNodes, presentationNodeTypes, type PresentationNode } from "./presentation-canvas";
import { PresentationStudioInspector } from "./presentation-studio-inspector";
import { PresentationLibraryPanel } from "./presentation-library-panel";
import { mergePresentation, presentationValuesEqual } from "../lib/presentation-merge";

const AUTOSAVE_DELAY = 1_200;
const CAMERA_DURATION = 700;
const MAX_IMAGE_SIDE = 480;
/** Well inside the server's lease timeout, so a live editor never looks abandoned. */
const LEASE_HEARTBEAT_INTERVAL = 15_000;
type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

async function requestEditLease(id: string, sessionId: string, action: "acquire" | "takeover" | "heartbeat" | "release"): Promise<{ editable?: boolean; holderName?: string }> {
  const response = await fetch(`/api/wiki/presentations/${id}/lease`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, action }), keepalive: action === "release",
  });
  if (!response.ok) throw new Error("Edit lease request failed");
  return response.json();
}

function StepRow({
  step,
  index,
  active,
  label,
  missing,
  readOnly,
  onSelect,
  onRemove,
  removeLabel,
  reorderLabel,
}: {
  step: PresentationStep;
  index: number;
  active: boolean;
  label: string;
  missing: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onRemove: () => void;
  removeLabel: string;
  reorderLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id, disabled: readOnly });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className={cn(
        "flex items-center gap-1 rounded-md border bg-card px-1.5 py-1.5 text-sm",
        active && "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40",
      )}
    >
      <button
        type="button"
        disabled={readOnly}
        className="cursor-grab touch-none rounded p-0.5 text-muted-foreground disabled:cursor-default disabled:opacity-40"
        {...attributes}
        {...listeners}
        aria-label={reorderLabel}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
      <button
        type="button"
        onClick={onSelect}
        className={cn("min-w-0 flex-1 truncate text-left", missing && "text-destructive")}
        title={label}
        aria-current={active ? "step" : undefined}
      >
        {label}
      </button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={readOnly} aria-label={removeLabel} onClick={onRemove}>
        <X className="size-3.5" />
      </Button>
    </li>
  );
}

/**
 * Every panel field holds a draft. It shows exactly what the author typed until the field
 * is left -- or Enter is pressed on a single-line one -- and resyncs whenever the value on
 * the canvas changes underneath it, which is what makes undo and redo visible in the panel.
 * `normalise` turns a finished draft into the value that is actually stored, so a number
 * field is clamped once instead of on every keystroke ("0.4" stays "0.4" while it is being
 * typed), and returning the current value from it is how an unusable entry reverts. Only a
 * value that really differs is committed: tabbing through the panel must not fill the undo
 * stack or mark the canvas unsaved.
 */
function useDraft(value: string, onCommit: (next: string) => void, normalise: (raw: string) => string = (raw) => raw) {
  const [draft, setDraft] = useState(value);
  // Adjusting the draft while rendering rather than in an effect: React re-runs this
  // component before touching the DOM, so an undo never flashes the stale text.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  return {
    draft,
    setDraft,
    commit: () => {
      const next = normalise(draft);
      setDraft(next);
      if (next !== value) onCommit(next);
    },
  };
}

type DraftFieldProps = {
  value: string;
  onCommit: (next: string) => void;
};

function DraftInput({
  value,
  onCommit,
  normalise,
  ...props
}: DraftFieldProps & { normalise?: (raw: string) => string } & Omit<
    React.ComponentProps<typeof Input>,
    "value" | "onChange" | "onBlur" | "onKeyDown"
  >) {
  const field = useDraft(value, onCommit, normalise);
  return (
    <Input
      {...props}
      value={field.draft}
      onChange={(event) => field.setDraft(event.currentTarget.value)}
      onBlur={field.commit}
      // Enter commits only here: in a textarea it is part of the text.
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        field.commit();
      }}
    />
  );
}

function DraftTextarea({
  value,
  onCommit,
  ...props
}: DraftFieldProps & Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange" | "onBlur">) {
  const field = useDraft(value, onCommit);
  return (
    <Textarea
      {...props}
      value={field.draft}
      onChange={(event) => field.setDraft(event.currentTarget.value)}
      onBlur={field.commit}
    />
  );
}

/** The schema's own bounds, so a duration field clamps to what the server will accept. */
const STEP_DURATION_RANGE = { min: 500, max: 120_000 };
const CAMERA_TRANSITION_RANGE = { min: 100, max: 5_000 };
/** Durations are seconds on screen and milliseconds in the document. */
const secondsText = (ms: number) => String(ms / 1000);
const msFromSecondsText = (seconds: string) => Math.round(Number(seconds) * 1000);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** The plain number fields read like the duration ones: the entry clamped into range, or
 * null when nothing usable was typed and the stored value should simply stay. */
const parseNumberInput = (raw: string, min: number, max: number): number | null => {
  const value = Number(raw.trim());
  return raw.trim() && Number.isFinite(value) ? clamp(value, min, max) : null;
};

/** Alignment lines are drawn in canvas coordinates, so they stay glued to the elements
 * they describe while the author pans and zooms. */
function SnapGuides({ guides }: { guides: SnapGuide[] }) {
  const { zoom } = useViewport();
  if (!guides.length) return null;
  return (
    <ViewportPortal>
      {guides.map((guide) => (
        <div
          key={`${guide.axis}-${guide.position}`}
          className="pointer-events-none absolute bg-indigo-500"
          style={
            guide.axis === "x"
              ? { left: guide.position, top: guide.start, width: 1 / zoom, height: guide.end - guide.start }
              : { left: guide.start, top: guide.position, height: 1 / zoom, width: guide.end - guide.start }
          }
        />
      ))}
    </ViewportPortal>
  );
}

/** A gesture never scales the selection away to nothing. */
const MIN_SCALE = 0.02;
/** Handle size and the rotate handle's stand-off, both in screen pixels. */
const HANDLE_SIZE = 12;
const ROTATE_OFFSET = 28;

/**
 * One overlay serves both jobs React Flow's own `NodeResizer` does not: turning a
 * selection, and scaling several elements as one. It is drawn around the union of the
 * selection, so a single element gets a rotation handle and a group gets both.
 */
function SelectionOverlay({
  bounds,
  scalable,
  rotateLabel,
  scaleLabel,
  onRotate,
  onScale,
}: {
  bounds: PresentationBounds;
  scalable: boolean;
  rotateLabel: string;
  scaleLabel: string;
  onRotate: (deltaDegrees: number, center: { x: number; y: number }) => void;
  onScale: (scaleX: number, scaleY: number, origin: { x: number; y: number }) => void;
}) {
  const { zoom } = useViewport();
  const reactFlow = useReactFlow();
  const screen = (value: number) => value / zoom;

  const beginGesture = (event: React.PointerEvent<HTMLButtonElement>, kind: "rotate" | "scale") => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    // The anchor is frozen at gesture start: the union bounds shift as the selection turns,
    // and chasing them mid-drag would make the element run away from the pointer.
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const origin = { x: bounds.x, y: bounds.y };
    const size = { width: bounds.width, height: bounds.height };
    const start = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    let lastAngle = Math.atan2(start.y - center.y, start.x - center.x);
    let lastScaleX = 1;
    let lastScaleY = 1;

    const move = (moveEvent: PointerEvent) => {
      const point = reactFlow.screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      if (kind === "rotate") {
        const angle = Math.atan2(point.y - center.y, point.x - center.x);
        onRotate(((angle - lastAngle) * 180) / Math.PI, center);
        lastAngle = angle;
        return;
      }
      const scaleX = Math.max((point.x - origin.x) / size.width, MIN_SCALE);
      // Shift keeps the proportions, which is the only way to scale a picture safely.
      const scaleY = moveEvent.shiftKey ? scaleX : Math.max((point.y - origin.y) / size.height, MIN_SCALE);
      onScale(scaleX / lastScaleX, scaleY / lastScaleY, origin);
      lastScaleX = scaleX;
      lastScaleY = scaleY;
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const handleStyle = { width: screen(HANDLE_SIZE), height: screen(HANDLE_SIZE), borderWidth: screen(1) };

  return (
    <ViewportPortal>
      <div
        className="pointer-events-none absolute"
        style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
      >
        {scalable && (
          <div
            className="absolute inset-0 border-dashed border-indigo-500"
            style={{ borderWidth: screen(1) }}
          />
        )}
        <button
          type="button"
          aria-label={rotateLabel}
          title={rotateLabel}
          className="nodrag nopan pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-white bg-indigo-500 active:cursor-grabbing"
          style={{ ...handleStyle, left: bounds.width / 2, top: -screen(ROTATE_OFFSET) }}
          onPointerDown={(event) => beginGesture(event, "rotate")}
        />
        {scalable && (
          <button
            type="button"
            aria-label={scaleLabel}
            title={scaleLabel}
            className="nodrag nopan pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-xs border-white bg-indigo-500"
            style={{ ...handleStyle, left: bounds.width, top: bounds.height }}
            onPointerDown={(event) => beginGesture(event, "scale")}
          />
        )}
      </div>
    </ViewportPortal>
  );
}

function Editor({
  presentation,
  revisions,
}: {
  presentation: PresentationRecord;
  revisions: PresentationRevisionItem[];
}) {
  const t = useTranslations("wiki");
  const studio = useTranslations("presentationStudio");
  const linkText = useTranslations("documentPresentationLinks");
  const navigationQuery = useSearchParams();
  // Canvas geometry is already stored; viewport sizing is the readiness signal.
  const viewportSized = useStore((state) => state.width > 0 && state.height > 0);
  const viewportEngine = useStore((state) => state.panZoom);
  const format = useFormatter();
  const router = useRouter();
  const reactFlow = useReactFlow<PresentationNode>();
  const { resolvedTheme } = useTheme();
  const canvasRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [sessionId] = useState(() => globalThis.crypto.randomUUID());
  const canEdit = presentation.role === "owner" || presentation.role === "edit";
  const baseSnapshot = useRef(presentation);

  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [leaseReady, setLeaseReady] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [activePanel, setActivePanel] = useState<"properties" | "sources" | "design" | "assets" | "comments" | null>(null);
  const [pathOpen, setPathOpen] = useState(false);
  const [workspaceDialog, setWorkspaceDialog] = useState<"sharing" | "history" | "playback" | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const readOnly = !canEdit || !leaseReady || lockedBy !== null || conflict;
  const disabled = readOnly || restoring !== null;
  const paused = useRef(false);
  const savedVersion = useRef(presentation.updatedAt);
  /**
   * The canvas, its undo stack and the alignment guides are one reducer: undo has to
   * snapshot exactly the canvas an edit is applied to, and a drag reports edits faster than
   * React re-renders, so every canvas change is expressed as a pure transition instead of a
   * read-modify-write. The stack lives for this editing session only.
   */
  const [canvas, dispatch] = useReducer(
    presentationCanvasReducer,
    presentation,
    (source) => initialPresentationCanvasState(source.elements, source.steps, source.background, source.settings, source.title),
  );
  const { elements, steps, guides, background, settings, title } = canvas;
  const sourcePreviews = usePresentationSourcePreviews(elements.map((element) => element.source));
  useEffect(() => {
    if (disabled || sourcePreviews.error || synchronizePresentationHeadings(elements, sourcePreviews.previews) === elements) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // A source refresh must not replace a custom label still being typed.
        // Blur commits that draft (and its override) before this next frame.
        if (document.activeElement?.hasAttribute("data-linked-heading-title")) return;
        dispatch({ type: "source-headings", elements: (current) => synchronizePresentationHeadings(current, sourcePreviews.previews) });
      });
    };
    sync();
    document.addEventListener("focusout", sync);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("focusout", sync); };
  }, [disabled, elements, sourcePreviews.error, sourcePreviews.previews]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionKey = selectedIds.join(":");
  const [inspectedSelection, setInspectedSelection] = useState(selectionKey);
  if (selectionKey !== inspectedSelection) {
    setInspectedSelection(selectionKey);
    if (selectionKey && !(pathOpen && !window.matchMedia("(min-width: 1280px)").matches)) setActivePanel((current) => current === "sources" || current === "comments" ? current : "properties");
    else if (!selectionKey) setActivePanel((current) => current === "properties" ? null : current);
  }
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [status, setStatus] = useState<Exclude<SaveState, "unsaved">>("idle");
  const [uploading, setUploading] = useState(false);

  // "Unsaved" is not a state of its own: it is the canvas being dirty while nothing is
  // in flight, which keeps the indicator honest even when an edit lands mid-save. A failed
  // write outranks it, so the error stays on screen until the author edits again.
  const saveState: SaveState = status === "saving"
    ? "saving"
    : canvas.failed ? "error" : canvas.dirty ? "unsaved" : status;

  // The paths that leave the editor -- unmount, "Präsentieren", "PDF-Export" -- run outside
  // React's data flow and need the canvas as it is at that moment, not as it was when they
  // were wired up.
  const latest = useRef({ canvas, readOnly });
  /** The write in flight, so a flush can wait for it and land after it. */
  const inFlight = useRef<Promise<boolean> | null>(null);
  const lastPersisted = useRef<PresentationCanvasState | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selection = useMemo(
    () => elements.filter((element) => selectedSet.has(element.id)),
    [elements, selectedSet],
  );
  // The property panel edits exactly one element; two or more are handled as a group.
  const selected = selection.length === 1 ? selection[0] : null;
  const selectionBounds = useMemo(() => unionBounds(selection), [selection]);
  const activeStep = steps.find((step) => step.id === activeStepId) ?? null;

  const commitElements = useCallback(
    (update: (current: PresentationElement[]) => PresentationElement[]) =>
      dispatch({ type: "edit", at: Date.now(), elements: update }),
    [],
  );

  const commitSteps = useCallback(
    (update: (current: PresentationStep[]) => PresentationStep[]) =>
      dispatch({ type: "edit", at: Date.now(), steps: update }),
    [],
  );

  /** Writes one canvas and reports whether it reached the database. Writes queue behind
   * each other so a flush during a save cannot race the older canvas back over the newer. */
  const persist = useCallback((state: PresentationCanvasState, afterNavigation = false) => {
    const write = async () => {
      setStatus("saving");
      try {
        const draft = {
          id: presentation.id,
          elements: state.elements,
          steps: state.steps,
          background: state.background,
          settings: state.settings,
          sessionId,
          title: state.title,
          expectedUpdatedAt: savedVersion.current,
          base: presentation.coediting ? baseSnapshot.current : undefined,
        };
        let result: Awaited<ReturnType<typeof savePresentation>>;
        if (afterNavigation || presentation.coediting) {
          const body = JSON.stringify(draft);
          const response = await fetch(`/api/wiki/presentations/${presentation.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body,
            // Browsers cap keepalive requests at 64 KiB. Larger canvases still save on
            // client navigation; closing the tab remains guarded by beforeunload.
            keepalive: new Blob([body]).size < 60_000,
          });
          if (!response.ok && response.status !== 409) throw new Error("Save failed");
          result = await response.json();
        } else {
          result = await savePresentation(draft);
        }
        // Someone took over while this tab was editing: stop writing rather than
        // overwriting their canvas with a stale one.
        if (result.locked) {
          setLockedBy(result.holderName);
          dispatch({ type: "failed" });
          setStatus("error");
          // The banner alone is easy to miss when the write was triggered by leaving.
          toast.error(result.holderName
            ? t("presentations.lockedBy", { name: result.holderName })
            : t("presentations.locked"));
          return false;
        }
        if (result.conflict) {
          setConflict(true);
          dispatch({ type: "failed" });
          setStatus("error");
          toast.error(t("presentations.saveConflict"));
          return false;
        }
        savedVersion.current = result.savedAt;
        if (result.snapshot) {
          baseSnapshot.current = { ...presentation, ...result.snapshot, updatedAt: result.savedAt };
          const expected = { elements: state.elements, steps: state.steps, background: state.background, settings: state.settings, title: state.title };
          if (!presentationValuesEqual(expected, result.snapshot)) {
            // The user may keep typing while the server merges this save. A conflict
            // with those newer keystrokes must also stop editing, not merely autosave.
            const rebased = mergePresentation(state, latest.current.canvas, result.snapshot);
            if (rebased.conflicts.length) {
              setConflict(true); dispatch({ type: "failed" }); setStatus("error");
              toast.error(t("presentations.saveConflict")); return false;
            }
            dispatch({ type: "remote", base: state, snapshot: result.snapshot });
            setStatus("saved"); return true;
          }
        }
        lastPersisted.current = state;
        dispatch({
          type: "saved",
          elements: state.elements,
          steps: state.steps,
          background: state.background,
          settings: state.settings,
          title: state.title,
        });
        setStatus("saved");
        return true;
      } catch {
        // Parked, not retried: the next edit clears `failed` and re-arms the autosave, so
        // a server that is down produces one toast instead of one per debounce.
        dispatch({ type: "failed" });
        setStatus("error");
        toast.error(t("presentations.saveFailed"));
        return false;
      }
    };
    const next = (inFlight.current ?? Promise.resolve(true)).then(write, write);
    inFlight.current = next;
    return next;
  }, [presentation, sessionId, t]);

  /** Writes whatever is on the canvas right now, waiting for a save already in flight.
   * Used by every exit that would otherwise drop the pending debounce on the floor. Leaving
   * mid-save with nothing further edited can repeat that same write once, which is a wasted
   * request rather than a wrong one. */
  const flush = useCallback(async () => {
    // Commit the field that still has focus before taking the save snapshot.
    flushSync(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await inFlight.current?.catch(() => false);
    const current = latest.current;
    if (!current.canvas.dirty) return true;
    if (current.readOnly) return false;
    return persist(current.canvas);
  }, [persist]);

  // Debounced autosave: every edit marks the canvas unsaved, and the last edit of a
  // burst is the one that writes.
  useEffect(() => {
    if (!canvas.dirty || canvas.failed || readOnly || restoring || status === "saving") return;
    const timer = setTimeout(() => { if (!paused.current) void persist(canvas); }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [canvas, status, persist, readOnly, restoring]);

  // Re-pointed after every commit, so the exits above see the canvas as it is now.
  useEffect(() => {
    latest.current = { canvas, readOnly };
  });

  // Browser back can hide the route's Activity boundary without a link click. The fixed
  // endpoint remains usable after navigation. Use the same queue and saved bookkeeping
  // so returning to a preserved editor does not retry an already-saved canvas.
  useEffect(() => () => {
    const saveOnExit = async () => {
      await inFlight.current;
      const current = latest.current;
      if (paused.current || current.readOnly || !current.canvas.dirty || current.canvas === lastPersisted.current) return;
      await persist(current.canvas, true);
    };
    void saveOnExit().catch(() => undefined);
  }, [persist]);

  // Edit lease: claim it on open, keep it warm while the tab lives, hand it back on exit.
  // A missed release is harmless — the lease expires on its own.
  useEffect(() => {
    if (!canEdit) return;
    let disposed = false;
    const claim = (takeover = false) => {
      void requestEditLease(presentation.id, sessionId, takeover ? "takeover" : "acquire")
        .then((result) => {
          if (disposed) return;
          setLockedBy(result.editable ? null : result.holderName ?? "");
          setLeaseReady(true);
          // The lock refused the last write and parked the autosave; now that it has
          // lifted, the edit still sitting here deserves another try.
          if (result.editable) dispatch({ type: "recovered" });
        })
        .catch(() => { if (!disposed) setLockedBy(""); });
    };
    // A reload leaves the previous page load's lease behind for up to a minute, so the
    // first claim takes over -- but only ever from this same user, enforced server-side.
    claim(true);
    const timer = window.setInterval(() => {
      if (disposed) return;
      // While locked out, keep asking: the holder's lease expires and this tab takes over
      // without the author having to reload.
      void requestEditLease(presentation.id, sessionId, "heartbeat")
        .then((result) => {
          if (!disposed && !result.editable) claim();
        })
        .catch(() => undefined);
    }, LEASE_HEARTBEAT_INTERVAL);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      // The route may already be hidden. Server actions post to the new document URL
      // and can fail during partial rendering; the fixed endpoint is independent of it.
      void requestEditLease(presentation.id, sessionId, "release").catch(() => undefined);
    };
  }, [presentation.id, sessionId, canEdit]);

  useEffect(() => {
    if (!presentation.coediting && canEdit) return;
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling || inFlight.current && latest.current.canvas.dirty || paused.current) return;
      polling = true;
      try {
        const response = await fetch(`/api/wiki/presentations/${presentation.id}`, { cache: "no-store" });
        if (!response.ok) { if (!disposed) setLockedBy(""); return; }
        const remote = await response.json() as PresentationRecord;
        if (disposed || remote.updatedAt === savedVersion.current) return;
        if (remote.role !== presentation.role) { setLockedBy(""); return; }
        const merged = mergePresentation(baseSnapshot.current, latest.current.canvas, remote);
        if (merged.conflicts.length) { setConflict(true); return; }
        dispatch({ type: "remote", base: baseSnapshot.current, snapshot: remote });
        baseSnapshot.current = remote; savedVersion.current = remote.updatedAt;
      } catch { /* Offline edits remain local and retry through normal save recovery. */ }
      finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [presentation.id, presentation.coediting, presentation.role, canEdit]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const draft = document.activeElement;
      const editing = draft instanceof HTMLInputElement || draft instanceof HTMLTextAreaElement;
      if (!latest.current.canvas.dirty && status !== "saving" && !editing) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [canvas.dirty, status]);

  const updateElement = useCallback(
    (id: string, update: (element: PresentationElement) => PresentationElement) => {
      commitElements((current) => {
        const source = current.find((element) => element.id === id);
        if (!source || isPresentationElementLocked(current, id)) return current;
        const next = preservePresentationHeadingOverride(source, update(source));
        let result = current;
        if (next.rotation !== source.rotation) result = rotateElements(result, new Set([id]), next.rotation - source.rotation, { x: source.x + source.width / 2, y: source.y + source.height / 2 });
        if (["x", "y", "width", "height"].some((key) => next[key as "x"] !== source[key as "x"])) result = applyGeometryChanges(result, [{ id, x: next.x, y: next.y, width: next.width, height: next.height }], 0).elements;
        return result.map((element) => element.id === id ? { ...next, x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation } : element);
      });
    },
    [commitElements],
  );

  const updateSettings = useCallback((update: Partial<PresentationSettings>) => {
    dispatch({ type: "touch", settings: update });
  }, []);

  const updateStepDuration = useCallback(
    (id: string, durationMs: number | undefined) => {
      commitSteps((current) => current.map((step) => (step.id === id ? { ...step, durationMs } : step)));
    },
    [commitSteps],
  );

  const onTextChange = useCallback(
    (id: string, text: string) => {
      updateElement(id, (element) => (element.type === "text" ? { ...element, content: { ...element.content, text, runs: undefined } } : element));
    },
    [updateElement],
  );

  const nodes = useMemo(
    () => elementsToNodes(elements, { editable: !disabled, selectedIds: selectedSet, onTextChange }),
    [elements, selectedSet, onTextChange, disabled],
  );

  /**
   * React Flow reports a whole gesture as one batch of changes, which is what makes group
   * dragging and snapping possible: the moving elements are collected first, aligned as a
   * single box against everything that stayed put, and only then written back.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange<PresentationNode>[]) => {
      const selectChanges = changes.filter((change) => change.type === "select");
      if (selectChanges.length) {
        setSelectedIds((current) => {
          const next = new Set(current);
          for (const change of selectChanges) {
            const group = presentationAncestors(elements, change.id).findLast((element) => element.type === "frame" && element.content.isGroup);
            if (change.selected) next.add(group?.id ?? change.id);
            else next.delete(change.id);
          }
          if (next.size === current.length && current.every((id) => next.has(id))) return current;
          return [...next];
        });
      }

      const geometry = new Map<string, PresentationGeometryChange>();
      let gesture = false;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          const element = elements.find((element) => element.id === change.id);
          const group = presentationAncestors(elements, change.id).findLast((element) => element.type === "frame" && element.content.isGroup);
          if (group && element) geometry.set(group.id, { id: group.id, x: group.x + change.position.x - element.x, y: group.y + change.position.y - element.y });
          else geometry.set(change.id, { ...geometry.get(change.id), id: change.id, x: change.position.x, y: change.position.y });
          if (change.dragging) gesture = true;
        } else if (change.type === "dimensions" && change.dimensions && (change.resizing || change.setAttributes)) {
          // React Flow also reports the dimensions it measured on mount; the reducer drops
          // those, so opening a presentation never looks unsaved.
          geometry.set(change.id, { ...geometry.get(change.id), id: change.id, ...change.dimensions });
          if (change.resizing) gesture = true;
        }
      }
      if (disabled || !geometry.size) return;
      dispatch({
        type: "geometry",
        at: Date.now(),
        changes: [...geometry.values()],
        // The snap has to feel the same at any zoom, so the screen tolerance is converted.
        tolerance: PRESENTATION_SNAP_TOLERANCE / reactFlow.getZoom(),
        gesture,
      });
    },
    [reactFlow, disabled, elements],
  );

  const rotateSelection = useCallback(
    (deltaDegrees: number, center: { x: number; y: number }) => {
      commitElements((current) => rotateElements(current, selectedSet, deltaDegrees, center));
    },
    [commitElements, selectedSet],
  );

  const scaleSelection = useCallback(
    (scaleX: number, scaleY: number, origin: { x: number; y: number }) => {
      commitElements((current) => scaleElements(current, selectedSet, origin, scaleX, scaleY));
    },
    [commitElements, selectedSet],
  );

  /** Where a new element lands: the middle of what the author is currently looking at. */
  const viewportCenter = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return reactFlow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [reactFlow]);

  const addElement = useCallback(
    (element: PresentationElement) => {
      if (disabled) return;
      if (elements.length >= 500) { toast.error(t("presentations.elementLimit")); return; }
      commitElements((current) => [...current, element]);
      setSelectedIds([element.id]);
    },
    [commitElements, disabled, elements.length, t],
  );

  /** Deleting takes the steps that pointed at the gone elements with it. */
  const deleteSelection = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const removed = presentationDescendants(elements, new Set(ids.filter((id) => !isPresentationElementLocked(elements, id))));
      // One action, so deleting an element and the stops that pointed at it is one undo.
      dispatch({
        type: "edit",
        at: Date.now(),
        elements: (current) => current.filter((element) => !removed.has(element.id)),
        steps: (current) => {
          const next = current.filter((step) => !removed.has(step.elementId));
          return next.length === current.length ? current : next;
        },
      });
      setSelectedIds((current) => current.filter((id) => !removed.has(id)));
    },
    [elements],
  );

  const duplicateSelection = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const included = presentationDescendants(elements, new Set(ids));
      if (elements.length + included.size > 500) { toast.error(t("presentations.elementLimit")); return; }
      // Ids are minted here rather than inside the update, which has to stay pure.
      const copies = new Map([...included].map((id) => [id, createId()]));
      commitElements((current) => duplicatePresentationTree(current, new Set(ids), copies));
      setSelectedIds(ids.map((id) => copies.get(id)!));
    },
    [commitElements, elements, t],
  );

  const reorderSelected = useCallback(
    (id: string, to: "front" | "back") => {
      commitElements((current) => reorderElement(current, id, to));
    },
    [commitElements],
  );

  /**
   * Delete, Ctrl+D and undo/redo are handled here rather than by React Flow's own key
   * options, so the shortcuts work no matter which pane has focus — and so a copy is offset
   * instead of landing exactly on the original. Typing in a field is never a canvas command.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!disabled) void flush();
        return;
      }
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (disabled || target?.closest("[role='dialog']")) return;
      const shortcut = event.ctrlKey || event.metaKey;
      if (shortcut && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      } else if (shortcut && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      } else if (!selectedIds.length) {
        return;
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection(selectedIds);
      } else if (shortcut && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelection(selectedIds);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection, duplicateSelection, selectedIds, disabled, flush]);

  const addText = useCallback(() => {
    const { x, y } = viewportCenter();
    addElement({
      id: createId(), type: "text", x: x - 160, y: y - 30, width: 320, height: 60, rotation: 0,
      content: { text: t("presentations.newTextPlaceholder"), fontSize: 32, bold: false, color: "", align: "left" },
    });
  }, [addElement, t, viewportCenter]);

  const addFrame = useCallback(() => {
    const { x, y } = viewportCenter();
    addElement({
      id: createId(), type: "frame", x: x - 320, y: y - 200, width: 640, height: 400, rotation: 0,
      content: { label: "", shape: "rect", color: "" },
    });
  }, [addElement, viewportCenter]);

  const addShape = useCallback(() => {
    const { x, y } = viewportCenter();
    addElement({
      id: createId(), type: "shape", x: x - 140, y: y - 90, width: 280, height: 180, rotation: 0,
      content: { shape: "rect", fill: "", stroke: "", strokeWidth: 2, opacity: 1 },
    });
  }, [addElement, viewportCenter]);

  const addStudioElement = (type: "chart" | "icon") => {
    const { x, y } = viewportCenter();
    const base = { id: createId(), x: x - 240, y: y - 150, width: 480, height: 300, rotation: 0 };
    if (type === "chart") addElement({ ...base, type, content: { title: studio("chartTitle"), kind: "bar", data: [{ label: "A", value: 20 }, { label: "B", value: 40 }, { label: "C", value: 30 }] } });
    else addElement({ ...base, width: 120, height: 120, type, content: { name: "target", color: "#6366f1" } });
  };

  const uploadMedia = async (file: File) => {
    if (disabled || uploading) return;
    setUploading(true);
    try {
      const body = new FormData(); body.append("file", file); body.append("entityType", "wikiPresentation"); body.append("entityId", presentation.id);
      const response = await fetch("/api/files", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok || !payload.id) throw new Error("Upload failed");
      const { x, y } = viewportCenter();
      addElement({ id: createId(), type: file.type.startsWith("video/") ? "video" : "audio", x: x - 240, y: y - 135, width: 480, height: file.type.startsWith("video/") ? 270 : 80, rotation: 0, content: { attachmentId: payload.id, title: file.name } });
    } catch { toast.error(studio("uploadFailed")); } finally { setUploading(false); }
  };

  const uploadImage = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        // Natural proportions up front, so the picture is not stretched into a default box.
        const objectUrl = URL.createObjectURL(file);
        const size = await new Promise<{ width: number; height: number }>((resolve) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => resolve({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE });
          image.src = objectUrl;
        });
        URL.revokeObjectURL(objectUrl);

        const body = new FormData();
        body.append("file", file);
        body.append("entityType", "wikiPresentation");
        body.append("entityId", presentation.id);
        const response = await fetch("/api/files", { method: "POST", body });
        const payload = (await response.json()) as { id?: string; error?: string };
        if (!response.ok || !payload.id) throw new Error(payload.error ?? "upload failed");

        const scale = MAX_IMAGE_SIDE / Math.max(size.width, size.height, 1);
        const { x, y } = viewportCenter();
        const width = Math.max(40, Math.round(size.width * scale));
        const height = Math.max(40, Math.round(size.height * scale));
        addElement({
          id: createId(), type: "image", x: x - width / 2, y: y - height / 2, width, height, rotation: 0,
          content: { attachmentId: payload.id, alt: file.name },
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("presentations.uploadFailed"));
      } finally {
        setUploading(false);
      }
    },
    [addElement, presentation.id, t, viewportCenter],
  );

  const pendingFly = useRef(0);
  useEffect(() => () => cancelAnimationFrame(pendingFly.current), []);
  const flyTo = useCallback(
    (element: PresentationElement) => {
      cancelAnimationFrame(pendingFly.current);
      // Tool panels can open in the same selection event. Let the canvas resize
      // before fitting an explicitly requested stop; ordinary panel toggles do not pan.
      pendingFly.current = requestAnimationFrame(() => {
        pendingFly.current = requestAnimationFrame(() => {
          void reactFlow.fitBounds(presentationCameraBounds(element), { padding: PRESENTATION_CAMERA_PADDING, duration: CAMERA_DURATION });
        });
      });
    },
    [reactFlow],
  );

  const requestedElement = navigationQuery.get("element");
  const resumeToken = navigationQuery.get("resume");
  const documentResumeToken = navigationQuery.get("documentResume");
  const appliedNavigation = useRef("");
  const appliedViewportEngine = useRef(viewportEngine);
  useEffect(() => {
    if (!viewportEngine || !reactFlow.viewportInitialized || !viewportSized) return;
    const navigationKey = `${presentation.id}:${requestedElement}:${resumeToken}`;
    if (appliedNavigation.current === navigationKey && appliedViewportEngine.current === viewportEngine) return;
    // Next can reactivate a cached editor with a recreated pan/zoom controller.
    // Restore once per controller, as well as once per destination.
    const timer = setTimeout(() => {
      appliedNavigation.current = navigationKey;
      appliedViewportEngine.current = viewportEngine;
      const saved = readLinkedPosition(resumeToken);
      if (saved?.kind === "presentation" && saved.id === presentation.id) {
        setSelectedIds(saved.selectedIds.filter((id) => elements.some((element) => element.id === id)));
        setActiveStepId(steps.some((step) => step.id === saved.activeStepId) ? saved.activeStepId : null);
        void reactFlow.setViewport(saved.viewport);
        if (saved.selectedIds.length) setActivePanel(requestedElement ? "sources" : "properties");
      } else if (requestedElement) {
        const target = elements.find((element) => element.id === requestedElement);
        if (target) { setSelectedIds([target.id]); setActiveStepId(steps.find((step) => step.elementId === target.id)?.id ?? null); flyTo(target); setActivePanel("sources"); }
        else { toast.error(linkText("missingElement")); void reactFlow.fitView({ padding: 0.2 }); }
      } else if (resumeToken) void reactFlow.fitView({ padding: 0.2 });
    }, 0);
    return () => clearTimeout(timer);
  }, [elements, flyTo, linkText, viewportSized, presentation.id, reactFlow, requestedElement, resumeToken, steps, viewportEngine]);

  const addStep = useCallback(() => {
    if (!selected || disabled) return;
    const step = { id: createId(), elementId: selected.id };
    commitSteps((current) => [...current, step]);
    setActiveStepId(step.id);
  }, [commitSteps, selected, disabled]);

  const updateStepNotes = useCallback(
    (stepId: string, notes: string) => {
      commitSteps((current) =>
        current.map((step) => (step.id === stepId ? { ...step, notes: notes || undefined } : step)),
      );
    },
    [commitSteps],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onStepDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (readOnly || !over || active.id === over.id) return;
    commitSteps((current) => moveStep(
      current,
      current.findIndex((step) => step.id === active.id),
      current.findIndex((step) => step.id === over.id),
    ));
  }, [commitSteps, readOnly]);

  /** Present and PDF export both read the canvas back from the database, so both have to
   * wait for a pending edit to be written before they hand over. */
  const listHref = "/wiki/presentations";
  const presentHref = `/wiki/presentations/${presentation.id}/present`;
  const printHref = `/print/presentations/${presentation.id}`;

  /** Hands over to a page rendered from the saved canvas once the pending edit has landed
   * -- flushing nothing when there is nothing to write. A tab that has to be new is opened
   * inside the click -- opening it after the await is what popup blockers exist for -- and
   * only then pointed at the target. A write that fails leaves the author here with their
   * edit and the toast. */
  const flushThen = useCallback((href: string, newTab: boolean) => {
    if (paused.current) return;
    const tab = newTab ? window.open("about:blank", "_blank") : null;
    if (newTab && !tab) {
      toast.error(t("presentations.popupBlocked"));
      return;
    }
    paused.current = true;
    void flush().then(async (saved) => {
      if (!newTab) {
        if (!saved) return;
        // Hand the lease back before navigation so the next editor can claim it at once.
        await requestEditLease(presentation.id, sessionId, "release").catch(() => undefined);
        router.push(href);
      } else if (tab) {
        if (saved) tab.location.href = href;
        else tab.close();
      }
    }).finally(() => { paused.current = false; });
  }, [flush, presentation.id, router, sessionId, t]);

  function openDocument(document: PresentationSourceDocument, sectionId: string, restoreDocument = false) {
    const token = rememberLinkedPosition({ kind: "presentation", id: presentation.id, viewport: reactFlow.getViewport(), selectedIds, activeStepId });
    let href = documentSectionHref(document.slug, sectionId, presentation.id, selected?.id ?? requestedElement ?? "", token);
    const previousDocument = readLinkedPosition(documentResumeToken);
    if (restoreDocument && previousDocument?.kind === "document" && previousDocument.id === document.id && documentResumeToken) href += `&documentResume=${encodeURIComponent(documentResumeToken)}`;
    flushThen(href, false);
  }
  async function returnToDocument() {
    const saved = readLinkedPosition(documentResumeToken);
    if (saved?.kind !== "document") return;
    try {
      const response = await fetch(`/api/wiki/presentation-sources?source=${encodeURIComponent(saved.id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!result.document) { toast.error(linkText("missingSource")); return; }
      openDocument(result.document, saved.sectionId, true);
    } catch { toast.error(linkText("loadFailed")); }
  }

  // The app and wiki navigation live outside this component. Save before their Link
  // handlers can unmount the editor, just as for its own breadcrumb and Present action.
  useEffect(() => {
    const onNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.closest('[data-testid="presentation-editor"]') || anchor.hasAttribute("download")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      flushThen(`${destination.pathname}${destination.search}${destination.hash}`, event.ctrlKey || event.metaKey || event.shiftKey || anchor.target === "_blank");
    };
    document.addEventListener("click", onNavigation, true);
    return () => document.removeEventListener("click", onNavigation, true);
  }, [flushThen]);
  /** Flush even a clean canvas: a focused field may still hold an uncommitted draft.
   * A modifier click keeps this editor open with its lease and opens a saved copy. */
  const leaveVia = (event: React.MouseEvent, href: string) => {
    const newTab = event.metaKey || event.ctrlKey || event.shiftKey;
    event.preventDefault();
    flushThen(href, newTab);
  };
  /** Middle-click never reaches onClick, and its default is the same new tab. */
  const auxFlush = (event: React.MouseEvent, href: string) => {
    if (event.button !== 1) return;
    event.preventDefault();
    flushThen(href, true);
  };

  const saveIndicator = {
    idle: null,
    unsaved: <span className="text-muted-foreground">{t("presentations.saveStates.unsaved")}</span>,
    saving: <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t("presentations.saveStates.saving")}</span>,
    saved: <span className="flex items-center gap-1 text-muted-foreground"><Check className="size-3.5" />{t("presentations.saveStates.saved")}</span>,
    error: <span className="flex items-center gap-1 text-destructive"><TriangleAlert className="size-3.5" />{t("presentations.saveStates.error")}</span>,
  }[saveState];

  const colorSwatches = (value: string, onPick: (color: string) => void) => (
    <ColorPicker aria-label={studio("color")} value={value} onChange={onPick} disabled={disabled || Boolean(selected?.locked)} clearLabel={t("presentations.colorDefault")} />
  );

  const colorField = (label: string, value: string, onPick: (color: string) => void) => (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ColorPicker aria-label={label} value={value} onChange={onPick} disabled={disabled} clearLabel={t("presentations.clearColor")} />
    </div>
  );

  const sourceAttention = elements.filter((element) => {
    if (!element.source) return false;
    const preview = sourcePreviews.previews.get(sourceKey(element.source));
    return preview && (sourceReviewStatus(element.source, preview) !== "current" || (element.type === "frame" && preview.snapshot?.headingStructure && !presentationValuesEqual(element.source.approvedStructure, preview.snapshot.headingStructure)));
  }).length;
  const sourcePanel = (          <PresentationSourcePanel structureDisabled={disabled} onStructureApply={(expected, proposal) => {
            if (disabled) return;
            dispatch({ type: "edit", at: Date.now(), separate: true, elements: (current) => applyStructureProposal(current, expected, proposal) });
            const target = proposal.elements.find((element) => element.id === (selected?.id ?? proposal.changes[0].elementId));
            if (target) flyTo(target);
          }} previews={sourcePreviews} elements={elements} selected={selected} disabled={disabled || Boolean(selected && isPresentationElementLocked(elements, selected.id))} onChange={(source) => { if (selected) updateElement(selected.id, (element) => ({ ...element, source })); }} onOpen={openDocument} onReview={(id, source) => updateElement(id, (element) => element.source?.pageId === source.pageId && element.source.sectionId === source.sectionId ? { ...element, source } : element)} onSelect={(id) => { setSelectedIds([id]); const element = elements.find((item) => item.id === id); if (element) flyTo(element); }} />
);
  const libraryPanel = (          <PresentationLibraryPanel section={activePanel === "assets" ? "assets" : activePanel === "comments" ? "comments" : "design"} id={presentation.id} selectedId={selected?.id} canEdit={canEdit && !disabled} onSelect={(id) => { setSelectedIds([id]); const element = elements.find((element) => element.id === id); if (element) flyTo(element); }} flush={flush}
            onTheme={(theme) => { commitElements((current) => current.map((element) => element.type === "text" ? { ...element, content: { ...element.content, color: theme.foreground, font: theme.font } } : element.type === "frame" ? { ...element, content: { ...element.content, color: theme.accent } } : element)); dispatch({ type: "touch", background: theme.background }); }}
            onTemplate={(snapshot) => { dispatch({ type: "edit", at: Date.now(), elements: () => snapshot.elements, steps: () => snapshot.steps }); dispatch({ type: "touch", background: snapshot.background, settings: snapshot.settings }); setSelectedIds([]); }}
            onAsset={(attachmentId, alt) => { const { x, y } = viewportCenter(); addElement({ id: createId(), type: "image", x, y, width: 360, height: 240, rotation: 0, content: { attachmentId, alt } }); }}
            onIcon={(name) => { const { x, y } = viewportCenter(); addElement({ id: createId(), type: "icon", x, y, width: 100, height: 100, rotation: 0, content: { name, color: "#6366f1" } }); }} />
);
  const sharingPanel = (          <PresentationLibraryPanel section="sharing" id={presentation.id} selectedId={selected?.id} canEdit={canEdit && !disabled} onSelect={(id) => { setSelectedIds([id]); const element = elements.find((element) => element.id === id); if (element) flyTo(element); }} flush={flush}
            onTheme={(theme) => { commitElements((current) => current.map((element) => element.type === "text" ? { ...element, content: { ...element.content, color: theme.foreground, font: theme.font } } : element.type === "frame" ? { ...element, content: { ...element.content, color: theme.accent } } : element)); dispatch({ type: "touch", background: theme.background }); }}
            onTemplate={(snapshot) => { dispatch({ type: "edit", at: Date.now(), elements: () => snapshot.elements, steps: () => snapshot.steps }); dispatch({ type: "touch", background: snapshot.background, settings: snapshot.settings }); setSelectedIds([]); }}
            onAsset={(attachmentId, alt) => { const { x, y } = viewportCenter(); addElement({ id: createId(), type: "image", x, y, width: 360, height: 240, rotation: 0, content: { attachmentId, alt } }); }}
            onIcon={(name) => { const { x, y } = viewportCenter(); addElement({ id: createId(), type: "icon", x, y, width: 100, height: 100, rotation: 0, content: { name, color: "#6366f1" } }); }} />
);
  const pathPanel = (<>
          <p className="mt-1 text-xs text-muted-foreground">{t("presentations.pathDescription")}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2 w-full" disabled={!selected || disabled || steps.length >= 500} onClick={addStep}>
            <Plus className="size-3.5" />{t("presentations.addStep")}
          </Button>
          {steps.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("presentations.noSteps")}</p>
          ) : (
            <DndContext id={`presentation-path-${presentation.id}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onStepDragEnd}>
              <SortableContext items={steps.map((step) => step.id)} strategy={verticalListSortingStrategy}>
                <ol className="mt-3 space-y-1.5">
                  {steps.map((step, index) => {
                    const target = stepTarget(step, elements);
                    return (
                      <StepRow
                        key={step.id}
                        step={step}
                        index={index}
                        active={activeStepId === step.id}
                        missing={!target}
                        readOnly={readOnly}
                        label={`${step.action && step.action !== "camera" ? `${studio(step.action)}: ` : ""}${target ? stepLabel(target, index) : t("presentations.missingStep")}`}
                        removeLabel={t("presentations.removeStep")}
                        reorderLabel={t("presentations.reorderStep", { number: index + 1 })}
                        onSelect={() => {
                          setActiveStepId(step.id);
                          if (target) {
                            setSelectedIds([target.id]);
                            flyTo(target);
                          }
                        }}
                        onRemove={() => commitSteps((current) => current.filter((entry) => entry.id !== step.id))}
                      />
                    );
                  })}
                </ol>
              </SortableContext>
            </DndContext>
          )}

          {activeStep && (
            <section className="mt-3 border-t pt-3">
              {selected && selected.id !== activeStep.elementId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mb-3 w-full"
                  disabled={readOnly}
                  onClick={() => commitSteps((current) => retargetStep(current, activeStep.id, selected.id))}
                >
                  <Target className="size-3.5" />
                  {t("presentations.retargetStep")}
                </Button>
              )}
              <label className="block text-xs text-muted-foreground">
                {t("presentations.stepDuration")}
                <DraftInput
                  type="number"
                  min={0.5}
                  max={120}
                  step={0.5}
                  className="mt-1 h-8"
                  placeholder={secondsText(settings.defaultStepDurationMs)}
                  value={activeStep.durationMs != null ? secondsText(activeStep.durationMs) : ""}
                  // An empty field is not a bad entry here: it hands the step back to the default.
                  normalise={(raw) => {
                    const ms = raw.trim() ? (parseSecondsInput(raw, STEP_DURATION_RANGE) ?? activeStep.durationMs) : undefined;
                    return ms == null ? "" : secondsText(ms);
                  }}
                  onCommit={(next) => updateStepDuration(activeStep.id, next ? msFromSecondsText(next) : undefined)}
                />
              </label>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("presentations.stepDurationHint")}</p>
              <h2 className="mt-3 text-xs font-semibold tracking-wide uppercase">{t("presentations.speakerNotes")}</h2>
              <DraftTextarea
                key={activeStep.id}
                aria-label={t("presentations.speakerNotes")}
                value={activeStep.notes ?? ""}
                maxLength={5_000}
                rows={4}
                className="mt-2"
                placeholder={t("presentations.speakerNotesPlaceholder")}
                onCommit={(notes) => updateStepNotes(activeStep.id, notes)}
              />
            </section>
          )}

</>);
  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-0 min-w-0 flex-col md:h-dvh" data-testid="presentation-editor" data-presentation-workspace>
      <header className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-background px-4 py-3">
        {documentResumeToken && <Button size="sm" variant="outline" onClick={() => void returnToDocument()}>{linkText("backDocument")}</Button>}
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
        <Link
          href={listHref}
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={(event) => leaveVia(event, listHref)}
          onAuxClick={(event) => auxFlush(event, listHref)}
        >
          {t("presentations.title")}
        </Link>
        <span className="text-muted-foreground">/</span>
        <DraftInput
          value={title}
          maxLength={200}
          disabled={disabled}
          aria-label={t("presentations.presentationTitle")}
          className="h-8 min-w-0 flex-1 border-transparent bg-transparent font-medium shadow-none hover:border-input sm:w-auto sm:max-w-xl sm:flex-1"
          normalise={(raw) => raw.trim() || title}
          onCommit={(next) => dispatch({ type: "touch", title: next })}
        />
        </div>
        <div className="flex w-full items-center justify-end gap-2 text-xs sm:ml-auto sm:w-auto">
          <span role="status" aria-live="polite" className="mr-auto sm:mr-0">{saveIndicator}</span>
          {saveState === "error" && <Button size="sm" variant="ghost" onClick={() => void flush()} disabled={disabled}><Save className="size-3.5" />{t("presentations.save")}</Button>}
          <Button size="sm" variant="ghost" aria-label={t("workspace.share")} onClick={() => setWorkspaceDialog("sharing")}><Share2 className="size-4" /><span className="hidden sm:inline">{t("workspace.share")}</span></Button>
          <DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t("workspace.actions")} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!steps.length || restoring !== null || uploading} onClick={() => flushThen(printHref, true)}><FileDown />{t("presentations.exportPdf")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setWorkspaceDialog("history")}><History />{t("presentations.history")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setWorkspaceDialog("playback")}><Settings />{t("presentations.playbackSettings")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={disabled} onClick={() => void flush()}><Save />{t("presentations.save")}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
          <Button
            type="button"
            size="sm"
            disabled={!steps.length || restoring !== null || uploading}
            nativeButton={false}
            role="link"
            // The player is server-rendered from the saved canvas, so the navigation waits
            // for the write, rather than presenting a stale canvas. A modifier click still
            // means "new tab" -- it just gets one with the edit in it.
            render={(
              <Link
                href={presentHref}
                onClick={(event) => leaveVia(event, presentHref)}
                onAuxClick={(event) => auxFlush(event, presentHref)}
              />
            )}
          >
            <Play className="size-3.5" />{t("presentations.present")}
          </Button>
        </div>
      </header>
      <div data-testid="presentation-toolbar" className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-background px-3 py-2">
        <Button size="sm" variant={pathOpen ? "secondary" : "ghost"} aria-expanded={pathOpen} onClick={() => { setPathOpen((value) => !value); if (!window.matchMedia("(min-width: 1280px)").matches) setActivePanel(null); }}><PanelLeft className="size-4" />{t("presentations.path")}</Button>
        <span className="mx-1 h-5 w-px bg-border/60" />
        <Button type="button" variant="ghost" size="sm" disabled={disabled || elements.length >= 500} onClick={addText}><Type className="size-3.5" />{t("presentations.addText")}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={uploading || disabled || elements.length >= 500} onClick={() => imageInputRef.current?.click()}>
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {t("presentations.addImage")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || elements.length >= 500} onClick={addFrame}><Square className="size-3.5" />{t("presentations.addFrame")}</Button>
        <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={disabled || uploading || elements.length >= 500} />}>{t("editor.toolbar.insert")}</DropdownMenuTrigger><DropdownMenuContent>
          <DropdownMenuItem onClick={addShape}><Shapes />{t("presentations.addShape")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => addStudioElement("chart")}>{studio("addChart")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => addStudioElement("icon")}>{studio("addIcon")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => mediaInputRef.current?.click()}>{studio("uploadMedia")}</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
        <input ref={mediaInputRef} aria-label={studio("uploadMedia")} hidden type="file" accept="video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadMedia(file); event.target.value = ""; }} />
        <input
          ref={imageInputRef}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void uploadImage(file);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("presentations.undo")}
          title={t("presentations.undo")}
          disabled={disabled || !canvas.past.length}
          onClick={() => dispatch({ type: "undo" })}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("presentations.redo")}
          title={t("presentations.redo")}
          disabled={disabled || !canvas.future.length}
          onClick={() => dispatch({ type: "redo" })}
        >
          <Redo2 className="size-4" />
        </Button>

        <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant={activePanel ? "secondary" : "ghost"} className="ml-auto" />}><PanelRight className="size-4" />{t("workspace.tools")}</DropdownMenuTrigger><DropdownMenuContent align="end">
          {(["properties", "sources", "design", "assets", "comments"] as const).map((panel) => <DropdownMenuItem key={panel} onClick={() => { setActivePanel(panel); if (!window.matchMedia("(min-width: 1280px)").matches) setPathOpen(false); }}>{t(`workspace.${panel}`)}</DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu>
      </div>
      {(sourcePreviews.error || sourceAttention > 0) && <button type="button" onClick={() => setActivePanel("sources")} className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-left text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><TriangleAlert className="size-3.5 shrink-0" /><span role="status">{sourcePreviews.error ? linkText("previewFailed") : linkText("needsReview", { count: sourceAttention })}</span></button>}

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-destructive/10 px-3 py-2 text-sm">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="flex-1">{t("presentations.saveConflict")}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(latest.current.canvas, null, 2)], { type: "application/json" }));
            const link = document.createElement("a"); link.href = url; link.download = "presentation-draft.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>{studio("downloadDraft")}</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>{t("presentations.reloadLatest")}</Button>
        </div>
      )}

      {!conflict && readOnly && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <Lock className="size-4 shrink-0" />
          <span>{!canEdit ? studio("viewOnly") : !leaseReady && lockedBy === null ? t("presentations.checkingAccess") : lockedBy ? t("presentations.lockedBy", { name: lockedBy }) : t("presentations.locked")}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <WorkspacePanel title={t("presentations.path")} open={pathOpen} onClose={() => setPathOpen(false)} side="left" narrow className="h-full max-h-full overflow-y-auto"><fieldset disabled={disabled} className="min-w-0">{pathPanel}</fieldset></WorkspacePanel>
        <div ref={canvasRef} className="relative min-h-40 min-w-0 flex-1 bg-muted/30">
          <div className="absolute right-3 bottom-3 z-10 rounded-lg border bg-background shadow-sm">        <Button type="button" variant="ghost" size="sm" onClick={() => void reactFlow.fitView({ padding: 0.15, duration: CAMERA_DURATION })}>
          <Maximize2 className="size-3.5" />{t("presentations.overview")}
        </Button>
</div>
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={presentationNodeTypes}
            onNodesChange={onNodesChange}
            colorMode={resolvedTheme === "dark" ? "dark" : "light"}
            fitView={!resumeToken && !requestedElement}
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.02}
            maxZoom={8}
            nodesConnectable={false}
            nodesDraggable={!disabled}
            // Delete is handled by the editor's own shortcut, so there is one delete path.
            deleteKeyCode={null}
            // Shift draws a marquee on the pane and adds to the selection on an element,
            // which is the pair of gestures every canvas tool has trained authors to expect.
            selectionKeyCode="Shift"
            multiSelectionKeyCode={["Shift", "Meta", "Control"]}
            selectionOnDrag={false}
            style={background ? { backgroundColor: background } : undefined}
            panOnDrag
            onPaneClick={() => setSelectedIds([])}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={24} size={1} />
            <Controls position="bottom-left" showInteractive={false} />
            {elements.length > 3 && <MiniMap className="!hidden sm:!block" position="top-right" pannable zoomable maskColor="rgb(15 23 42 / 0.08)" />}
            <SnapGuides guides={guides} />
            {!disabled && selectionBounds && !selection.some((element) => isPresentationElementLocked(elements, element.id)) && (
              <SelectionOverlay
                bounds={selectionBounds}
                // One element resizes with React Flow's own handles; a group needs its own.
                scalable={selection.length > 1}
                rotateLabel={t("presentations.rotateHandle")}
                scaleLabel={t("presentations.scaleHandle")}
                onRotate={rotateSelection}
                onScale={scaleSelection}
              />
            )}
          </ReactFlow>
          {!elements.length && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
              <div>
                <Square className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">{t("presentations.emptyCanvasTitle")}</p>
                <p className="mt-1 max-w-xs text-xs text-muted-foreground">{t("presentations.emptyCanvasDescription")}</p>
              </div>
            </div>
          )}
        </div>

        <WorkspacePanel title={t(`workspace.${activePanel ?? "properties"}`)} open={activePanel !== null} onClose={() => setActivePanel(null)} className="h-full max-h-full overflow-y-auto">
          <div hidden={activePanel !== "sources"}>{sourcePanel}</div>
          <div hidden={!["design", "assets", "comments"].includes(activePanel ?? "")}>{libraryPanel}</div>
          <div hidden={activePanel !== "properties"}>
          <fieldset disabled={disabled} className="min-w-0">
          {selection.length > 1 && (
            <section className="mt-5 border-t pt-4">
              <div className="flex items-center justify-between gap-1">
                <h2 className="min-w-0 truncate text-xs font-semibold tracking-wide uppercase">
                  {t("presentations.selectionCount", { count: selection.length })}
                </h2>
                <div className="flex shrink-0 items-center">
                  <Button type="button" variant="ghost" size="icon-sm" disabled={readOnly} aria-label={t("presentations.duplicateElement")} onClick={() => duplicateSelection(selectedIds)}>
                    <Copy className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={readOnly} aria-label={t("presentations.deleteElement")} onClick={() => deleteSelection(selectedIds)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <RotateCw className="size-3.5 shrink-0" />
                {t("presentations.groupHint")}
              </p>
            </section>
          )}

          {selected && (
            <section className="mt-5 border-t pt-4">
              <div className="flex items-center justify-between gap-1">
                <h2 className="min-w-0 truncate text-xs font-semibold tracking-wide uppercase">{t(`presentations.elementTypes.${selected.type}`)}</h2>
                <div className="flex shrink-0 items-center">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.bringToFront")} onClick={() => reorderSelected(selected.id, "front")}>
                    <ArrowUpToLine className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.sendToBack")} onClick={() => reorderSelected(selected.id, "back")}>
                    <ArrowDownToLine className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.duplicateElement")} onClick={() => duplicateSelection([selected.id])}>
                    <Copy className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.deleteElement")} onClick={() => deleteSelection([selected.id])}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <label className="block text-xs text-muted-foreground">
                  {t("presentations.rotation")}
                  <DraftInput
                    type="number"
                    min={-360}
                    max={360}
                    step={5}
                    className="mt-1 h-8"
                    key={`${selected.id}-rotation`}
                    value={String(selected.rotation)}
                    normalise={(raw) => String(Math.round(parseNumberInput(raw, -360, 360) ?? selected.rotation))}
                    onCommit={(next) => updateElement(selected.id, (element) => ({ ...element, rotation: Number(next) }))}
                  />
                </label>
                {colorField(t("presentations.elementBackground"), selected.background ?? "", (color) =>
                  updateElement(selected.id, (element) => ({ ...element, background: color })),
                )}
              </div>

              {selected.type === "text" && (
                <div className="mt-3 space-y-3">
                  <DraftTextarea
                    key={selected.id}
                    aria-label={t("presentations.textContent")}
                    value={selected.content.text}
                    maxLength={5_000}
                    rows={4}
                    onCommit={(text) => onTextChange(selected.id, text)}
                  />
                  <label className="block text-xs text-muted-foreground">
                    {t("presentations.fontSize")}
                    <DraftInput
                      type="number"
                      min={8}
                      max={400}
                      className="mt-1 h-8"
                      key={`${selected.id}-size`}
                      value={String(selected.content.fontSize)}
                      normalise={(raw) => String(Math.round(parseNumberInput(raw, 8, 400) ?? selected.content.fontSize))}
                      onCommit={(next) =>
                        updateElement(selected.id, (element) =>
                          element.type === "text" ? { ...element, content: { ...element.content, fontSize: Number(next) } } : element,
                        )
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant={selected.content.bold ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        updateElement(selected.id, (element) =>
                          element.type === "text" ? { ...element, content: { ...element.content, bold: !element.content.bold } } : element,
                        )
                      }
                    >
                      {t("presentations.bold")}
                    </Button>
                    {(["left", "center", "right"] as const).map((align) => (
                      <Button
                        key={align}
                        type="button"
                        variant={selected.content.align === align ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          updateElement(selected.id, (element) =>
                            element.type === "text" ? { ...element, content: { ...element.content, align } } : element,
                          )
                        }
                      >
                        {t(`presentations.align.${align}`)}
                      </Button>
                    ))}
                  </div>
                  {colorSwatches(selected.content.color, (color) =>
                    updateElement(selected.id, (element) =>
                      element.type === "text" ? { ...element, content: { ...element.content, color } } : element,
                    ),
                  )}
                </div>
              )}

              {selected.type === "image" && (
                <label className="mt-3 block text-xs text-muted-foreground">
                  {t("presentations.altText")}
                  <DraftInput
                    key={selected.id}
                    className="mt-1 h-8"
                    value={selected.content.alt}
                    maxLength={500}
                    onCommit={(alt) =>
                      updateElement(selected.id, (element) =>
                        element.type === "image" ? { ...element, content: { ...element.content, alt } } : element,
                      )
                    }
                  />
                </label>
              )}

              {selected.type === "frame" && (
                <div className="mt-3 space-y-3">
                  <label className="block text-xs text-muted-foreground">
                    {t("presentations.frameLabel")}
                    <DraftInput
                      key={selected.id}
                      className="mt-1 h-8"
                      value={selected.content.label}
                      data-linked-heading-title=""
                      maxLength={200}
                      onCommit={(label) =>
                        updateElement(selected.id, (element) =>
                          element.type === "frame" ? { ...element, content: { ...element.content, label } } : element,
                        )
                      }
                    />
                  </label>
                  <div className="flex gap-1.5">
                    {presentationFrameShapes.map((shape) => (
                      <Button
                        key={shape}
                        type="button"
                        variant={selected.content.shape === shape ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          updateElement(selected.id, (element) =>
                            element.type === "frame" ? { ...element, content: { ...element.content, shape } } : element,
                          )
                        }
                      >
                        {t(`presentations.frameShapes.${shape}`)}
                      </Button>
                    ))}
                  </div>
                  {colorSwatches(selected.content.color, (color) =>
                    updateElement(selected.id, (element) =>
                      element.type === "frame" ? { ...element, content: { ...element.content, color } } : element,
                    ),
                  )}
                </div>
              )}

              {selected.type === "shape" && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {presentationShapeKinds.map((shape) => (
                      <Button
                        key={shape}
                        type="button"
                        variant={selected.content.shape === shape ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          updateElement(selected.id, (element) =>
                            element.type === "shape" ? { ...element, content: { ...element.content, shape } } : element,
                          )
                        }
                      >
                        {t(`presentations.shapeKinds.${shape}`)}
                      </Button>
                    ))}
                  </div>
                  {colorField(t("presentations.fill"), selected.content.fill, (fill) =>
                    updateElement(selected.id, (element) =>
                      element.type === "shape" ? { ...element, content: { ...element.content, fill } } : element,
                    ),
                  )}
                  {colorField(t("presentations.stroke"), selected.content.stroke, (stroke) =>
                    updateElement(selected.id, (element) =>
                      element.type === "shape" ? { ...element, content: { ...element.content, stroke } } : element,
                    ),
                  )}
                  <label className="block text-xs text-muted-foreground">
                    {t("presentations.strokeWidth")}
                    <DraftInput
                      type="number"
                      min={0}
                      max={200}
                      className="mt-1 h-8"
                      key={`${selected.id}-stroke-width`}
                      value={String(selected.content.strokeWidth)}
                      normalise={(raw) => String(parseNumberInput(raw, 0, 200) ?? selected.content.strokeWidth)}
                      onCommit={(next) =>
                        updateElement(selected.id, (element) =>
                          element.type === "shape" ? { ...element, content: { ...element.content, strokeWidth: Number(next) } } : element,
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    {t("presentations.opacity")}
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      className="mt-1 w-full"
                      value={selected.content.opacity}
                      onChange={(event) => {
                        const opacity = Number(event.target.value);
                        updateElement(selected.id, (element) =>
                          element.type === "shape" ? { ...element, content: { ...element.content, opacity } } : element,
                        );
                      }}
                    />
                  </label>
                </div>
              )}
            </section>
          )}

          <PresentationStudioInspector elements={elements} selectedIds={selectedIds} activeStep={activeStep}
            onElements={commitElements} onSelect={setSelectedIds} onUpdate={(element) => updateElement(element.id, () => element)} onSteps={commitSteps}
            disabled={disabled || uploading} />
          <section className="mt-5 border-t pt-4">
            <h2 className="text-xs font-semibold tracking-wide uppercase">{t("presentations.canvas")}</h2>
            <div className="mt-3">
              {colorField(t("presentations.canvasBackground"), background, (color) => {
                dispatch({ type: "touch", background: color });
              })}
            </div>
          </section>

          </fieldset>
          </div>
        </WorkspacePanel>
      </div>
      <Dialog open={workspaceDialog !== null} onOpenChange={(open) => { if (!open) setWorkspaceDialog(null); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{workspaceDialog === "sharing" ? studio("sharing") : workspaceDialog === "history" ? t("presentations.history") : t("presentations.playbackSettings")}</DialogTitle></DialogHeader>
          {workspaceDialog === "sharing" && sharingPanel}
          {workspaceDialog === "history" && <fieldset disabled={disabled}>          <section className="mt-5 border-t pt-4">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
              <History className="size-3.5" />{t("presentations.history")}
            </h2>
            {revisions.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("presentations.noRevisions")}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {revisions.map((revision) => (
                  <li key={revision.id} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{format.dateTime(revision.createdAt, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Vienna" })}</span>
                      <span className="block truncate text-muted-foreground">{revision.createdByName}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={readOnly || restoring !== null}
                      onClick={async () => {
                        if (!confirm(t("presentations.restoreConfirm"))) return;
                        paused.current = true;
                        setRestoring(revision.id);
                        try {
                          if (!await flush()) return;
                          const restored = await restorePresentationRevision({ revisionId: revision.id, sessionId, expectedUpdatedAt: savedVersion.current });
                          savedVersion.current = restored.savedAt;
                          dispatch({ type: "reset", snapshot: restored.snapshot });
                          setSelectedIds([]);
                          setActiveStepId(null);
                          setStatus("saved");
                          setWorkspaceDialog(null);
                          router.refresh();
                        } catch {
                          toast.error(t("presentations.restoreFailed"));
                        } finally {
                          paused.current = false;
                          setRestoring(null);
                        }
                      }}
                    >
                      {restoring === revision.id ? <Loader2 className="size-3.5 animate-spin" /> : t("presentations.restore")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
</fieldset>}
          {workspaceDialog === "playback" && <>            <fieldset disabled={disabled} className="space-y-3">
            <label className="block text-xs text-muted-foreground">
              {t("presentations.defaultStepDuration")}
              <DraftInput
                type="number"
                min={0.5}
                max={120}
                step={0.5}
                className="mt-1 h-8"
                value={secondsText(settings.defaultStepDurationMs)}
                normalise={(raw) => secondsText(parseSecondsInput(raw, STEP_DURATION_RANGE) ?? settings.defaultStepDurationMs)}
                onCommit={(next) => updateSettings({ defaultStepDurationMs: msFromSecondsText(next) })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={settings.loop} onCheckedChange={(checked) => updateSettings({ loop: checked === true })} />
              {t("presentations.loopPlayback")}
            </label>
            <label className="block text-xs text-muted-foreground">
              {t("presentations.cameraTransition")}
              <DraftInput
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                className="mt-1 h-8"
                value={secondsText(settings.cameraTransitionMs)}
                normalise={(raw) => secondsText(parseSecondsInput(raw, CAMERA_TRANSITION_RANGE) ?? settings.cameraTransitionMs)}
                onCommit={(next) => updateSettings({ cameraTransitionMs: msFromSecondsText(next) })}
              />
            </label>
            <label className="block text-xs text-muted-foreground">
              {t("presentations.cameraEasing")}
              <select
                className="mt-1 h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none dark:bg-input/30"
                value={settings.cameraEasing}
                onChange={(event) => updateSettings({ cameraEasing: event.target.value as PresentationCameraEasing })}
              >
                {presentationCameraEasings.map((easing) => (
                  <option key={easing} value={easing}>{t(`presentations.easings.${easing}`)}</option>
                ))}
              </select>
            </label>
            </fieldset>
</>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PresentationEditor({
  presentation,
  revisions,
}: {
  presentation: PresentationRecord;
  revisions: PresentationRevisionItem[];
}) {
  return (
    <ReactFlowProvider>
      <Editor key={presentation.id} presentation={presentation} revisions={revisions} />
    </ReactFlowProvider>
  );
}
