"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { createId } from "@paralleldrive/cuid2";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
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
  GripVertical,
  History,
  ImagePlus,
  Loader2,
  Lock,
  Maximize2,
  Play,
  Plus,
  Save,
  Settings,
  Shapes,
  Square,
  Trash2,
  TriangleAlert,
  Type,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  acquirePresentationEditLease,
  heartbeatPresentationEditLease,
  releasePresentationEditLease,
  renamePresentation,
  restorePresentationRevision,
  savePresentation,
} from "../presentation-actions";
import type { PresentationRecord, PresentationRevisionItem } from "../presentation-queries";
import {
  PRESENTATION_CAMERA_PADDING,
  duplicateElement,
  elementBounds,
  moveStep,
  presentationCameraEasings,
  presentationFrameShapes,
  presentationShapeKinds,
  reorderElement,
  stepLabel,
  stepTarget,
  type PresentationCameraEasing,
  type PresentationElement,
  type PresentationSettings,
  type PresentationStep,
} from "../lib/presentation";
import { elementsToNodes, presentationNodeTypes, type PresentationNode } from "./presentation-canvas";

/** Empty means "follow the theme"; the rest read acceptably on light and dark canvases. */
const COLORS = ["", "#6366f1", "#0d9488", "#f59e0b", "#e11d48", "#0ea5e9"] as const;
const AUTOSAVE_DELAY = 1_200;
const CAMERA_DURATION = 700;
const MAX_IMAGE_SIDE = 480;
/** Well inside the server's lease timeout, so a live editor never looks abandoned. */
const LEASE_HEARTBEAT_INTERVAL = 15_000;

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

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
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
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
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
      <button
        type="button"
        onClick={onSelect}
        className={cn("min-w-0 flex-1 truncate text-left", missing && "text-destructive")}
        title={label}
      >
        {label}
      </button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={readOnly} aria-label={removeLabel} onClick={onRemove}>
        <X className="size-3.5" />
      </Button>
    </li>
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
  const router = useRouter();
  const reactFlow = useReactFlow<PresentationNode>();
  const { resolvedTheme } = useTheme();
  const canvasRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const sessionId = useRef(globalThis.crypto.randomUUID());

  const [lockedBy, setLockedBy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const readOnly = lockedBy !== null;
  const [title, setTitle] = useState(presentation.title);
  const [elements, setElements] = useState<PresentationElement[]>(presentation.elements);
  const [background, setBackground] = useState(presentation.background);
  const [steps, setSteps] = useState<PresentationStep[]>(presentation.steps);
  const [settings, setSettings] = useState<PresentationSettings>(presentation.settings);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploading, setUploading] = useState(false);

  const selected = elements.find((element) => element.id === selectedId) ?? null;
  const activeStep = steps.find((step) => step.id === activeStepId) ?? null;

  const persist = useCallback(
    async (
      nextElements: PresentationElement[],
      nextSteps: PresentationStep[],
      nextBackground: string,
      nextSettings: PresentationSettings,
    ) => {
      setSaveState("saving");
      try {
        const result = await savePresentation({
          id: presentation.id,
          elements: nextElements,
          steps: nextSteps,
          background: nextBackground,
          settings: nextSettings,
          sessionId: sessionId.current,
        });
        // Someone took over while this tab was editing: stop writing rather than
        // overwriting their canvas with a stale one.
        if (result.locked) {
          setLockedBy(result.holderName);
          setSaveState("error");
          return;
        }
        setSaveState("saved");
      } catch {
        setSaveState("error");
        toast.error(t("presentations.saveFailed"));
      }
    },
    [presentation.id, t],
  );

  // Debounced autosave: every edit marks the canvas unsaved, and the last edit of a
  // burst is the one that writes.
  useEffect(() => {
    if (saveState !== "unsaved" || readOnly) return;
    const timer = setTimeout(() => void persist(elements, steps, background, settings), AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [saveState, elements, steps, background, settings, persist, readOnly]);

  // Edit lease: claim it on open, keep it warm while the tab lives, hand it back on exit.
  // A missed release is harmless — the lease expires on its own.
  useEffect(() => {
    const session = sessionId.current;
    let disposed = false;
    const claim = () => {
      void acquirePresentationEditLease({ id: presentation.id, sessionId: session })
        .then((result) => {
          if (!disposed) setLockedBy(result.editable ? null : result.holderName);
        })
        .catch(() => undefined);
    };
    claim();
    const timer = window.setInterval(() => {
      if (disposed) return;
      // While locked out, keep asking: the holder's lease expires and this tab takes over
      // without the author having to reload.
      void heartbeatPresentationEditLease({ id: presentation.id, sessionId: session })
        .then((result) => {
          if (!disposed && !result.editable) claim();
        })
        .catch(() => undefined);
    }, LEASE_HEARTBEAT_INTERVAL);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      void releasePresentationEditLease({ id: presentation.id, sessionId: session }).catch(() => undefined);
    };
  }, [presentation.id]);

  useEffect(() => {
    if (saveState !== "unsaved" && saveState !== "saving") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const updateElement = useCallback((id: string, update: (element: PresentationElement) => PresentationElement) => {
    setElements((current) => current.map((element) => (element.id === id ? update(element) : element)));
    setSaveState("unsaved");
  }, []);

  const updateSettings = useCallback((update: Partial<PresentationSettings>) => {
    setSettings((current) => ({ ...current, ...update }));
    setSaveState("unsaved");
  }, []);

  const updateStepDuration = useCallback((id: string, durationMs: number | undefined) => {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, durationMs } : step)));
    setSaveState("unsaved");
  }, []);

  const onTextChange = useCallback(
    (id: string, text: string) => {
      updateElement(id, (element) => (element.type === "text" ? { ...element, content: { ...element.content, text } } : element));
    },
    [updateElement],
  );

  const nodes = useMemo(
    () => elementsToNodes(elements, { editable: !readOnly, selectedId, onTextChange }),
    [elements, selectedId, onTextChange, readOnly],
  );

  const onNodesChange = useCallback((changes: NodeChange<PresentationNode>[]) => {
    for (const change of changes) {
      if (change.type === "select") {
        setSelectedId((previous) => (change.selected ? change.id : previous === change.id ? null : previous));
      }
    }
    let touched = false;
    setElements((current) => {
      let next = current;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          next = next.map((element) =>
            element.id === change.id && (element.x !== change.position!.x || element.y !== change.position!.y)
              ? { ...element, x: change.position!.x, y: change.position!.y }
              : element,
          );
        } else if (change.type === "dimensions" && change.dimensions && (change.resizing || change.setAttributes)) {
          // React Flow also reports the dimensions it measured on mount; only a real
          // difference counts as an edit, otherwise every load would look unsaved.
          const { width, height } = change.dimensions;
          next = next.map((element) =>
            element.id === change.id && (Math.abs(element.width - width) > 0.5 || Math.abs(element.height - height) > 0.5)
              ? { ...element, width, height }
              : element,
          );
        }
      }
      touched = next !== current;
      return next;
    });
    if (touched) setSaveState("unsaved");
  }, []);

  /** Where a new element lands: the middle of what the author is currently looking at. */
  const viewportCenter = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return reactFlow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [reactFlow]);

  const addElement = useCallback(
    (element: PresentationElement) => {
      setElements((current) => [...current, element]);
      setSelectedId(element.id);
      setSaveState("unsaved");
    },
    [],
  );

  const deleteElement = useCallback((id: string) => {
    setElements((current) => current.filter((element) => element.id !== id));
    setSteps((current) => current.filter((step) => step.elementId !== id));
    setSelectedId((current) => (current === id ? null : current));
    setSaveState("unsaved");
  }, []);

  const duplicateSelected = useCallback((id: string) => {
    setElements((current) => {
      const { elements: next, element } = duplicateElement(current, id, createId());
      if (element) setSelectedId(element.id);
      return next;
    });
    setSaveState("unsaved");
  }, []);

  const reorderSelected = useCallback((id: string, to: "front" | "back") => {
    setElements((current) => reorderElement(current, id, to));
    setSaveState("unsaved");
  }, []);

  /**
   * Delete and Ctrl+D are handled here rather than by React Flow's `deleteKeyCode`, so the
   * shortcuts work no matter which pane has focus — and so a copy is offset instead of
   * landing exactly on the original. Typing in a field is never a canvas command.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!selectedId || readOnly) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteElement(selectedId);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected(selectedId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteElement, duplicateSelected, selectedId, readOnly]);

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

  const flyTo = useCallback(
    (element: PresentationElement) => {
      void reactFlow.fitBounds(elementBounds(element), { padding: PRESENTATION_CAMERA_PADDING, duration: CAMERA_DURATION });
    },
    [reactFlow],
  );

  const addStep = useCallback(() => {
    if (!selected) return;
    setSteps((current) => [...current, { id: createId(), elementId: selected.id }]);
    setSaveState("unsaved");
  }, [selected]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onStepDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (readOnly || !over || active.id === over.id) return;
    setSteps((current) => {
      const from = current.findIndex((step) => step.id === active.id);
      const to = current.findIndex((step) => step.id === over.id);
      return moveStep(current, from, to);
    });
    setSaveState("unsaved");
  }, [readOnly]);

  const saveIndicator = {
    idle: null,
    unsaved: <span className="text-muted-foreground">{t("presentations.saveStates.unsaved")}</span>,
    saving: <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t("presentations.saveStates.saving")}</span>,
    saved: <span className="flex items-center gap-1 text-muted-foreground"><Check className="size-3.5" />{t("presentations.saveStates.saved")}</span>,
    error: <span className="flex items-center gap-1 text-destructive"><TriangleAlert className="size-3.5" />{t("presentations.saveStates.error")}</span>,
  }[saveState];

  const colorSwatches = (value: string, onPick: (color: string) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {COLORS.map((color) => (
        <button
          key={color || "default"}
          type="button"
          aria-label={color ? t("presentations.colorNamed", { color }) : t("presentations.colorDefault")}
          onClick={() => onPick(color)}
          className={cn(
            "size-6 rounded-full border-2",
            value === color ? "border-indigo-500" : "border-transparent",
            !color && "bg-foreground",
          )}
          style={color ? { backgroundColor: color } : undefined}
        />
      ))}
    </div>
  );

  /** Native picker plus a reset, because `<input type="color">` cannot express "none". */
  const colorField = (label: string, value: string, onPick: (color: string) => void) => (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <input
        type="color"
        aria-label={label}
        value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
        onChange={(event) => onPick(event.target.value)}
        className="h-7 w-10 cursor-pointer rounded border bg-transparent p-0.5"
      />
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.clearColor")} onClick={() => onPick("")}>
        <X className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col md:h-screen">
      <header className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <Link href="/wiki/presentations" className="text-sm text-muted-foreground hover:text-foreground">
          {t("presentations.title")}
        </Link>
        <span className="text-muted-foreground">/</span>
        <Input
          value={title}
          maxLength={200}
          disabled={readOnly}
          aria-label={t("presentations.presentationTitle")}
          className="h-8 w-56 font-medium"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={async (event) => {
            const next = event.target.value.trim();
            if (!next || next === presentation.title) return setTitle(next || presentation.title);
            try {
              await renamePresentation({ id: presentation.id, title: next });
              router.refresh();
            } catch {
              toast.error(t("presentations.saveFailed"));
            }
          }}
        />
        <span className="mx-1 h-5 w-px bg-border" />
        <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={addText}><Type className="size-3.5" />{t("presentations.addText")}</Button>
        <Button type="button" variant="outline" size="sm" disabled={uploading || readOnly} onClick={() => imageInputRef.current?.click()}>
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {t("presentations.addImage")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={addFrame}><Square className="size-3.5" />{t("presentations.addFrame")}</Button>
        <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={addShape}><Shapes className="size-3.5" />{t("presentations.addShape")}</Button>
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
        <Button type="button" variant="ghost" size="sm" onClick={() => void reactFlow.fitView({ padding: 0.15, duration: CAMERA_DURATION })}>
          <Maximize2 className="size-3.5" />{t("presentations.overview")}
        </Button>
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" />}>
            <Settings className="size-3.5" />{t("presentations.playbackSettings")}
          </PopoverTrigger>
          <PopoverContent className="w-72 space-y-3 p-3">
            <label className="block text-xs text-muted-foreground">
              {t("presentations.defaultStepDuration")}
              <Input
                type="number"
                min={0.5}
                max={120}
                step={0.5}
                className="mt-1 h-8"
                value={settings.defaultStepDurationMs / 1000}
                onChange={(event) => {
                  const seconds = Number(event.currentTarget.value);
                  if (!Number.isFinite(seconds)) return;
                  updateSettings({ defaultStepDurationMs: Math.round(Math.min(120, Math.max(0.5, seconds)) * 1000) });
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={settings.loop} onCheckedChange={(checked) => updateSettings({ loop: checked === true })} />
              {t("presentations.loopPlayback")}
            </label>
            <label className="block text-xs text-muted-foreground">
              {t("presentations.cameraTransition")}
              <Input
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                className="mt-1 h-8"
                value={settings.cameraTransitionMs / 1000}
                onChange={(event) => {
                  const seconds = Number(event.currentTarget.value);
                  if (!Number.isFinite(seconds)) return;
                  updateSettings({ cameraTransitionMs: Math.round(Math.min(5, Math.max(0.1, seconds)) * 1000) });
                }}
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
          </PopoverContent>
        </Popover>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {saveIndicator}
          <Button type="button" variant="outline" size="sm" onClick={() => void persist(elements, steps, background, settings)} disabled={saveState === "saving" || readOnly}>
            <Save className="size-3.5" />{t("presentations.save")}
          </Button>
          <Button type="button" size="sm" disabled={!steps.length} render={<Link href={`/wiki/presentations/${presentation.id}/present`} />}>
            <Play className="size-3.5" />{t("presentations.present")}
          </Button>
        </div>
      </header>

      {readOnly && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <Lock className="size-4 shrink-0" />
          <span>{lockedBy ? t("presentations.lockedBy", { name: lockedBy }) : t("presentations.locked")}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div ref={canvasRef} className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={[]}
            nodeTypes={presentationNodeTypes}
            onNodesChange={onNodesChange}
            colorMode={resolvedTheme === "dark" ? "dark" : "light"}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.02}
            maxZoom={8}
            nodesConnectable={false}
            nodesDraggable={!readOnly}
            // Delete is handled by the editor's own shortcut, so there is one delete path.
            deleteKeyCode={null}
            selectionOnDrag={false}
            style={background ? { backgroundColor: background } : undefined}
            panOnDrag
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={24} size={1} />
            <Controls position="bottom-left" showInteractive={false} />
            {elements.length > 3 && <MiniMap position="bottom-right" pannable zoomable maskColor="rgb(15 23 42 / 0.08)" />}
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

        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l bg-background p-3 lg:block">
          <h2 className="text-xs font-semibold tracking-wide uppercase">{t("presentations.path")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("presentations.pathDescription")}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2 w-full" disabled={!selected} onClick={addStep}>
            <Plus className="size-3.5" />{t("presentations.addStep")}
          </Button>
          {steps.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">{t("presentations.noSteps")}</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onStepDragEnd}>
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
                        label={target ? stepLabel(target, index) : t("presentations.missingStep")}
                        removeLabel={t("presentations.removeStep")}
                        onSelect={() => {
                          setActiveStepId(step.id);
                          if (target) {
                            setSelectedId(target.id);
                            flyTo(target);
                          }
                        }}
                        onRemove={() => {
                          setSteps((current) => current.filter((entry) => entry.id !== step.id));
                          setSaveState("unsaved");
                        }}
                      />
                    );
                  })}
                </ol>
              </SortableContext>
            </DndContext>
          )}

          {activeStep && (
            <section className="mt-3 border-t pt-3">
              <label className="block text-xs text-muted-foreground">
                {t("presentations.stepDuration")}
                <Input
                  type="number"
                  min={0.5}
                  max={120}
                  step={0.5}
                  className="mt-1 h-8"
                  placeholder={String(settings.defaultStepDurationMs / 1000)}
                  value={activeStep.durationMs != null ? activeStep.durationMs / 1000 : ""}
                  onChange={(event) => {
                    const raw = event.currentTarget.value;
                    if (!raw) return updateStepDuration(activeStep.id, undefined);
                    const seconds = Number(raw);
                    if (!Number.isFinite(seconds)) return;
                    updateStepDuration(activeStep.id, Math.round(Math.min(120, Math.max(0.5, seconds)) * 1000));
                  }}
                />
              </label>
              <p className="mt-1 text-[11px] text-muted-foreground">{t("presentations.stepDurationHint")}</p>
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
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.duplicateElement")} onClick={() => duplicateSelected(selected.id)}>
                    <Copy className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("presentations.deleteElement")} onClick={() => deleteElement(selected.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <label className="block text-xs text-muted-foreground">
                  {t("presentations.rotation")}
                  <Input
                    type="number"
                    min={-360}
                    max={360}
                    step={5}
                    className="mt-1 h-8"
                    key={`${selected.id}-rotation`}
                    defaultValue={selected.rotation}
                    onBlur={(event) => {
                      const value = Math.min(360, Math.max(-360, Math.round(Number(event.currentTarget.value) || 0)));
                      updateElement(selected.id, (element) => ({ ...element, rotation: value }));
                    }}
                  />
                </label>
                {colorField(t("presentations.elementBackground"), selected.background ?? "", (color) =>
                  updateElement(selected.id, (element) => ({ ...element, background: color })),
                )}
              </div>

              {selected.type === "text" && (
                <div className="mt-3 space-y-3">
                  <Textarea
                    key={selected.id}
                    aria-label={t("presentations.textContent")}
                    defaultValue={selected.content.text}
                    maxLength={5_000}
                    rows={4}
                    onBlur={(event) => onTextChange(selected.id, event.currentTarget.value)}
                  />
                  <label className="block text-xs text-muted-foreground">
                    {t("presentations.fontSize")}
                    <Input
                      type="number"
                      min={8}
                      max={400}
                      className="mt-1 h-8"
                      key={`${selected.id}-size`}
                      defaultValue={selected.content.fontSize}
                      onBlur={(event) => {
                        const value = Math.min(400, Math.max(8, Math.round(Number(event.currentTarget.value) || 32)));
                        updateElement(selected.id, (element) =>
                          element.type === "text" ? { ...element, content: { ...element.content, fontSize: value } } : element,
                        );
                      }}
                    />
                  </label>
                  <div className="flex gap-1.5">
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
                  <Input
                    key={selected.id}
                    className="mt-1 h-8"
                    defaultValue={selected.content.alt}
                    maxLength={500}
                    onBlur={(event) => {
                      const alt = event.currentTarget.value;
                      updateElement(selected.id, (element) =>
                        element.type === "image" ? { ...element, content: { ...element.content, alt } } : element,
                      );
                    }}
                  />
                </label>
              )}

              {selected.type === "frame" && (
                <div className="mt-3 space-y-3">
                  <label className="block text-xs text-muted-foreground">
                    {t("presentations.frameLabel")}
                    <Input
                      key={selected.id}
                      className="mt-1 h-8"
                      defaultValue={selected.content.label}
                      maxLength={200}
                      onBlur={(event) => {
                        const label = event.currentTarget.value;
                        updateElement(selected.id, (element) =>
                          element.type === "frame" ? { ...element, content: { ...element.content, label } } : element,
                        );
                      }}
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
                    <Input
                      type="number"
                      min={0}
                      max={200}
                      className="mt-1 h-8"
                      key={`${selected.id}-stroke-width`}
                      defaultValue={selected.content.strokeWidth}
                      onBlur={(event) => {
                        const strokeWidth = Math.min(200, Math.max(0, Number(event.currentTarget.value) || 0));
                        updateElement(selected.id, (element) =>
                          element.type === "shape" ? { ...element, content: { ...element.content, strokeWidth } } : element,
                        );
                      }}
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

          <section className="mt-5 border-t pt-4">
            <h2 className="text-xs font-semibold tracking-wide uppercase">{t("presentations.canvas")}</h2>
            <div className="mt-3">
              {colorField(t("presentations.canvasBackground"), background, (color) => {
                setBackground(color);
                setSaveState("unsaved");
              })}
            </div>
          </section>

          <section className="mt-5 border-t pt-4">
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
                      <span className="block truncate">{new Date(revision.createdAt).toLocaleString()}</span>
                      <span className="block truncate text-muted-foreground">{revision.createdByName}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={readOnly || restoring !== null}
                      onClick={async () => {
                        if (!confirm(t("presentations.restoreConfirm"))) return;
                        setRestoring(revision.id);
                        try {
                          await restorePresentationRevision({ revisionId: revision.id });
                          // The canvas lives in component state, so the restored version
                          // only shows after a full reload.
                          window.location.reload();
                        } catch {
                          setRestoring(null);
                          toast.error(t("presentations.restoreFailed"));
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
        </aside>
      </div>
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
