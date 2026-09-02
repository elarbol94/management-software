import { z } from "zod";

/**
 * A presentation is a single infinite canvas plus an ordered path across it. Elements
 * carry their own geometry; a step is only a reference to one of them, so moving or
 * resizing an element automatically moves the camera target that points at it.
 */

export const presentationFrameShapes = ["rect", "circle", "none"] as const;
export type PresentationFrameShape = (typeof presentationFrameShapes)[number];

export const presentationElementTypes = ["text", "image", "frame", "shape"] as const;
export type PresentationElementType = (typeof presentationElementTypes)[number];

export const presentationShapeKinds = ["rect", "ellipse", "arrow", "line"] as const;
export type PresentationShapeKind = (typeof presentationShapeKinds)[number];

const geometrySchema = {
  id: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(20).max(20_000),
  height: z.number().finite().min(20).max(20_000),
  rotation: z.number().finite().min(-360).max(360).default(0),
  /** Optional so every presentation saved before backgrounds existed still parses. */
  background: z.string().max(32).optional(),
};

const textElementSchema = z.object({
  ...geometrySchema,
  type: z.literal("text"),
  content: z.object({
    text: z.string().max(5_000).default(""),
    fontSize: z.number().int().min(8).max(400).default(32),
    bold: z.boolean().default(false),
    color: z.string().max(32).default(""),
    align: z.enum(["left", "center", "right"]).default("left"),
  }),
});

const imageElementSchema = z.object({
  ...geometrySchema,
  type: z.literal("image"),
  content: z.object({
    attachmentId: z.string().min(1).max(64),
    alt: z.string().max(500).default(""),
  }),
});

const frameElementSchema = z.object({
  ...geometrySchema,
  type: z.literal("frame"),
  content: z.object({
    label: z.string().max(200).default(""),
    shape: z.enum(presentationFrameShapes).default("rect"),
    color: z.string().max(32).default(""),
  }),
});

/** Empty `fill`/`stroke` mean "no fill" and "follow the theme", so shapes read on both. */
const shapeElementSchema = z.object({
  ...geometrySchema,
  type: z.literal("shape"),
  content: z.object({
    shape: z.enum(presentationShapeKinds).default("rect"),
    fill: z.string().max(32).default(""),
    stroke: z.string().max(32).default(""),
    strokeWidth: z.number().finite().min(0).max(200).default(2),
    opacity: z.number().finite().min(0).max(1).default(1),
  }),
});

export const presentationElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  imageElementSchema,
  frameElementSchema,
  shapeElementSchema,
]);
export type PresentationElement = z.infer<typeof presentationElementSchema>;
export type PresentationTextElement = z.infer<typeof textElementSchema>;
export type PresentationImageElement = z.infer<typeof imageElementSchema>;
export type PresentationFrameElement = z.infer<typeof frameElementSchema>;
export type PresentationShapeElement = z.infer<typeof shapeElementSchema>;

export const presentationStepSchema = z.object({
  id: z.string().min(1).max(64),
  elementId: z.string().min(1).max(64),
  // Overrides the presentation's default autoplay duration for this stop only.
  durationMs: z.number().int().min(500).max(120_000).optional(),
  // Optional and additive so presentations saved before presenter notes existed still parse.
  notes: z.string().max(5_000).optional(),
});
export type PresentationStep = z.infer<typeof presentationStepSchema>;

export const presentationElementsSchema = presentationElementSchema.array().max(500);
export const presentationStepsSchema = presentationStepSchema.array().max(500);

export const presentationCameraEasings = ["linear", "ease", "ease-in", "ease-out", "ease-in-out", "ease-out-back"] as const;
export type PresentationCameraEasing = (typeof presentationCameraEasings)[number];

/** Playback settings for one presentation: autoplay pacing plus the camera curve shared
 * by manual step navigation and autoplay, so the two never feel different. */
export const presentationSettingsSchema = z.object({
  defaultStepDurationMs: z.number().int().min(500).max(120_000).default(4_000),
  loop: z.boolean().default(false),
  cameraTransitionMs: z.number().int().min(100).max(5_000).default(700),
  cameraEasing: z.enum(presentationCameraEasings).default("ease-in-out"),
});
export type PresentationSettings = z.infer<typeof presentationSettingsSchema>;
export const defaultPresentationSettings: PresentationSettings = presentationSettingsSchema.parse({});

// react-flow's fitBounds/fitView take a d3-ease-style `(t) => t` function rather than a
// CSS easing keyword, so the setting's name is mapped to the small set of standard curves.
export const presentationCameraEasingFns: Record<PresentationCameraEasing, (t: number) => number> = {
  linear: (t) => t,
  ease: (t) => t * t * (3 - 2 * t),
  "ease-in": (t) => t * t,
  "ease-out": (t) => t * (2 - t),
  "ease-in-out": (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
  // Standard "easeOutBack" curve (easings.net): overshoots past 1 before settling, giving
  // step transitions a slight camera "pop" instead of a flat glide.
  "ease-out-back": (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

export type PresentationBounds = { x: number; y: number; width: number; height: number };

/** Padding around a step target, as a share of the target's size. */
export const PRESENTATION_CAMERA_PADDING = 0.12;

/**
 * The canvas column used to hold a bare element array. It now holds an envelope that can
 * also carry the canvas background and playback settings, and the bare array stays
 * readable so presentations saved before the envelope existed keep opening.
 */
export const presentationCanvasSchema = z.union([
  z.object({
    elements: presentationElementsSchema,
    background: z.string().max(32).default(""),
    settings: presentationSettingsSchema.default(defaultPresentationSettings),
  }),
  presentationElementsSchema.transform((elements) => ({
    elements,
    background: "",
    settings: defaultPresentationSettings,
  })),
]);
export type PresentationCanvas = z.infer<typeof presentationCanvasSchema>;

export function parsePresentationCanvas(json: string): PresentationCanvas {
  try {
    return presentationCanvasSchema.parse(JSON.parse(json));
  } catch {
    return { elements: [], background: "", settings: defaultPresentationSettings };
  }
}

/**
 * Z-order is the order of the array: the last element of its band paints on top. Frames
 * keep their own band behind everything else (see `elementsToNodes`), so bringing a frame
 * to the front raises it above other frames, not above the content sitting inside it.
 */
export function reorderElement(
  elements: PresentationElement[],
  id: string,
  to: "front" | "back",
): PresentationElement[] {
  const index = elements.findIndex((element) => element.id === id);
  if (index < 0) return elements;
  const rest = elements.filter((element) => element.id !== id);
  return to === "front" ? [...rest, elements[index]] : [elements[index], ...rest];
}

/** Offset so the copy is visibly its own element rather than hiding under the original. */
export const PRESENTATION_DUPLICATE_OFFSET = 24;

export function duplicateElement(
  elements: PresentationElement[],
  id: string,
  newId: string,
): { elements: PresentationElement[]; element: PresentationElement | null } {
  const source = elements.find((element) => element.id === id);
  if (!source) return { elements, element: null };
  const copy: PresentationElement = {
    ...source,
    id: newId,
    x: source.x + PRESENTATION_DUPLICATE_OFFSET,
    y: source.y + PRESENTATION_DUPLICATE_OFFSET,
    content: { ...source.content },
  } as PresentationElement;
  return { elements: [...elements, copy], element: copy };
}

export function parsePresentationSteps(json: string): PresentationStep[] {
  try {
    return presentationStepsSchema.parse(JSON.parse(json));
  } catch {
    return [];
  }
}

/**
 * Camera target for one element. Rotation is deliberately ignored: the frame a reader
 * lands on is the axis-aligned box the element occupies, which is what React Flow's
 * `fitBounds` consumes.
 */
export function elementBounds(element: PresentationElement): PresentationBounds {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

/** Takes anything box-shaped, so a selection of elements and a set of raw boxes both work. */
export function unionBounds(boxes: PresentationBounds[]): PresentationBounds | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A4 landscape at the CSS reference resolution of 96 dpi, which is what a printer hands
 * `@page { size: A4 landscape; margin: 0 }`. Keeping the page in px lets the export reuse
 * the canvas' own pixel geometry unchanged.
 */
export const PRESENTATION_PAGE_SIZE = { width: 1122.5, height: 793.7 };

export type PresentationPageTransform = { scale: number; offsetX: number; offsetY: number };

/**
 * The print equivalent of the player's `fitBounds`: pad the step's target, fit it to the
 * page, and centre it. A canvas point p lands at `p * scale + offset` on the page, so one
 * transform frames a whole page's worth of elements.
 */
export function fitBoundsToPage(
  bounds: PresentationBounds,
  page: { width: number; height: number } = PRESENTATION_PAGE_SIZE,
  padding: number = PRESENTATION_CAMERA_PADDING,
): PresentationPageTransform {
  const scale = Math.min(
    page.width / (Math.max(bounds.width, 1) * (1 + padding)),
    page.height / (Math.max(bounds.height, 1) * (1 + padding)),
  );
  return {
    scale,
    offsetX: page.width / 2 - (bounds.x + bounds.width / 2) * scale,
    offsetY: page.height / 2 - (bounds.y + bounds.height / 2) * scale,
  };
}

/**
 * Steps whose element was deleted would fly the camera nowhere, so they are dropped on
 * read rather than on delete — a step list is only ever as valid as the canvas it points at.
 */
export function normalizeSteps(
  steps: PresentationStep[],
  elements: PresentationElement[],
): PresentationStep[] {
  const known = new Set(elements.map((element) => element.id));
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (!known.has(step.elementId) || seen.has(step.id)) return false;
    seen.add(step.id);
    return true;
  });
}

export function moveStep(steps: PresentationStep[], from: number, to: number): PresentationStep[] {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The element a step points at, or null once the canvas no longer contains it. */
export function stepTarget(
  step: PresentationStep,
  elements: PresentationElement[],
): PresentationElement | null {
  return elements.find((element) => element.id === step.elementId) ?? null;
}

/**
 * The step a clicked element should jump to — the click-to-jump counterpart of `stepTarget`.
 * When several steps target the same element, the lowest-indexed one wins, matching the
 * order the presenter walks the path in. Null means no step points here: a free-look click.
 */
export function stepIndexForElement(steps: PresentationStep[], elementId: string): number | null {
  const index = steps.findIndex((step) => step.elementId === elementId);
  return index === -1 ? null : index;
}

/**
 * Revision and lease policy, copied from the wiki page editor so both editors behave the
 * same: one automatic snapshot per author per five minutes, and a lease that dies sixty
 * seconds after the last heartbeat.
 */
export const PRESENTATION_REVISION_THROTTLE_MS = 5 * 60_000;
export const PRESENTATION_LEASE_TIMEOUT_MS = 60_000;

/** A burst of autosaves must leave one snapshot, not one per keystroke pause. */
export function shouldSnapshotRevision(lastRevisionAt: number | null, now: number): boolean {
  return lastRevisionAt === null || now - lastRevisionAt > PRESENTATION_REVISION_THROTTLE_MS;
}

/** True while somebody else is actively editing; a lease past its timeout is free to take. */
export function isLeaseHeldByOther(
  lease: { sessionId: string; heartbeatAt: number } | null,
  sessionId: string,
  now: number,
): boolean {
  return Boolean(lease && lease.sessionId !== sessionId && now - lease.heartbeatAt <= PRESENTATION_LEASE_TIMEOUT_MS);
}

/**
 * A duration field types seconds and stores milliseconds. The clamp happens once, here, on
 * a finished entry -- clamping every keystroke is what turns a typed "0.4" into 0.14 --
 * and `null` means "nothing usable was typed", which the editor reads as leaving the
 * stored value alone rather than as a zero.
 */
export function parseSecondsInput(raw: string, range: { min: number; max: number }): number | null {
  const trimmed = raw.trim();
  const seconds = Number(trimmed);
  if (!trimmed || !Number.isFinite(seconds)) return null;
  return Math.round(Math.min(range.max, Math.max(range.min, seconds * 1000)));
}

/** A step's own duration wins over the presentation's default autoplay pacing. */
export function resolveStepDuration(step: PresentationStep, settings: PresentationSettings): number {
  return step.durationMs ?? settings.defaultStepDurationMs;
}

/** Elements that belong to a step's target — the target itself, plus anything nested
 * inside its bounds — which is what fades in together when the step arrives. */
export function elementsWithinStep(
  target: PresentationElement,
  elements: PresentationElement[],
): PresentationElement[] {
  const bounds = elementBounds(target);
  return elements.filter((element) => {
    if (element.id === target.id) return true;
    const box = elementBounds(element);
    return (
      box.x >= bounds.x &&
      box.y >= bounds.y &&
      box.x + box.width <= bounds.x + bounds.width &&
      box.y + box.height <= bounds.y + bounds.height
    );
  });
}

/** Retargeting a step keeps its id, duration and notes — only the camera target moves. */
export function retargetStep(
  steps: PresentationStep[],
  stepId: string,
  elementId: string,
): PresentationStep[] {
  return steps.map((step) => (step.id === stepId ? { ...step, elementId } : step));
}

/** Smallest box an element may be dragged or scaled down to, shared with the canvas resizer. */
export const PRESENTATION_MIN_ELEMENT_SIZE = 40;

/** Snap distance in *screen* pixels; the caller divides by the zoom to get canvas units,
 * so the pull feels the same however far the author has zoomed out. */
export const PRESENTATION_SNAP_TOLERANCE = 6;

/** One alignment line to draw: `position` on `axis`, spanning `start`..`end` across it. */
export type SnapGuide = { axis: "x" | "y"; position: number; start: number; end: number };

/** The three lines an edge can align to on one axis: near edge, centre, far edge. */
function linesOf(start: number, size: number): [number, number, number] {
  return [start, start + size / 2, start + size];
}

/**
 * One axis of the snap. A pure move offers all three of its own lines and shifts the whole
 * box; a resize offers only the edges that actually moved and drags just that edge, so
 * snapping the right edge never pulls the left one along.
 */
function snapAxis(
  prev: { start: number; size: number },
  next: { start: number; size: number },
  targets: { start: number; size: number }[],
  threshold: number,
): { start: number; size: number; line: number | null } {
  const resized = Math.abs(next.size - prev.size) > 0.01;
  const sources = resized
    ? [
      ...(Math.abs(next.start - prev.start) > 0.01 ? [next.start] : []),
      ...(Math.abs(next.start + next.size - (prev.start + prev.size)) > 0.01 ? [next.start + next.size] : []),
    ]
    : linesOf(next.start, next.size);

  let best: { delta: number; line: number; source: number } | null = null;
  for (const source of sources) {
    for (const target of targets) {
      for (const line of linesOf(target.start, target.size)) {
        const delta = line - source;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, line, source };
        }
      }
    }
  }
  if (!best) return { start: next.start, size: next.size, line: null };
  if (!resized) return { start: next.start + best.delta, size: next.size, line: best.line };
  if (best.source === next.start) {
    const far = next.start + next.size;
    const size = Math.max(far - (next.start + best.delta), PRESENTATION_MIN_ELEMENT_SIZE);
    return { start: far - size, size, line: best.line };
  }
  return { start: next.start, size: Math.max(next.size + best.delta, PRESENTATION_MIN_ELEMENT_SIZE), line: best.line };
}

/**
 * Align a dragged or resized box to the edges and centres of the boxes that stayed put.
 * `prev` is what the box looked like before this gesture step, which is the only way to
 * tell a move from a resize — and a frame is just another target, so an element snaps
 * flush into a frame and back out of it with no special case.
 */
export function snapBounds(
  prev: PresentationBounds,
  next: PresentationBounds,
  targets: PresentationBounds[],
  threshold: number,
): { bounds: PresentationBounds; guides: SnapGuide[] } {
  const horizontal = snapAxis(
    { start: prev.x, size: prev.width },
    { start: next.x, size: next.width },
    targets.map((target) => ({ start: target.x, size: target.width })),
    threshold,
  );
  const vertical = snapAxis(
    { start: prev.y, size: prev.height },
    { start: next.y, size: next.height },
    targets.map((target) => ({ start: target.y, size: target.height })),
    threshold,
  );
  const bounds = { x: horizontal.start, y: vertical.start, width: horizontal.size, height: vertical.size };

  const guides: SnapGuide[] = [];
  if (horizontal.line !== null) {
    const matched = targets.filter((target) => linesOf(target.x, target.width).some((line) => Math.abs(line - horizontal.line!) < 0.01));
    guides.push({
      axis: "x",
      position: horizontal.line,
      start: Math.min(bounds.y, ...matched.map((target) => target.y)),
      end: Math.max(bounds.y + bounds.height, ...matched.map((target) => target.y + target.height)),
    });
  }
  if (vertical.line !== null) {
    const matched = targets.filter((target) => linesOf(target.y, target.height).some((line) => Math.abs(line - vertical.line!) < 0.01));
    guides.push({
      axis: "y",
      position: vertical.line,
      start: Math.min(bounds.x, ...matched.map((target) => target.x)),
      end: Math.max(bounds.x + bounds.width, ...matched.map((target) => target.x + target.width)),
    });
  }
  return { bounds, guides };
}

/** Sub-pixel geometry is measurement noise from the renderer, not an edit. */
const GEOMETRY_EPSILON = 0.5;

/** One element's new geometry as the canvas reports it; absent fields keep their value. */
export type PresentationGeometryChange = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

/**
 * Apply a batch of drag/resize changes with snapping. The batch is treated as one gesture:
 * the moving elements are aligned as a single box against everything that stayed put, so a
 * group keeps its arrangement and a lone element snaps on its own edges and centre.
 */
export function applyGeometryChanges(
  elements: PresentationElement[],
  changes: PresentationGeometryChange[],
  tolerance: number,
): { elements: PresentationElement[]; guides: SnapGuide[] } {
  const byId = new Map(changes.map((change) => [change.id, change]));
  const moving = new Map<string, PresentationBounds>();
  for (const element of elements) {
    const change = byId.get(element.id);
    if (!change) continue;
    moving.set(element.id, {
      x: change.x ?? element.x,
      y: change.y ?? element.y,
      width: change.width ?? element.width,
      height: change.height ?? element.height,
    });
  }
  const before = unionBounds(elements.filter((element) => moving.has(element.id)));
  const after = unionBounds([...moving.values()]);
  if (!before || !after) return { elements, guides: [] };

  const targets = elements.filter((element) => !moving.has(element.id)).map(elementBounds);
  const snapped = snapBounds(before, after, targets, tolerance);
  // Only a resize changes the box's size, and a canvas resizes one element at a time, so
  // the snapped union *is* that element's box. A move shifts every mover by the same amount.
  const resizing = moving.size === 1
    && (Math.abs(snapped.bounds.width - before.width) > 0.01 || Math.abs(snapped.bounds.height - before.height) > 0.01);
  const dx = snapped.bounds.x - after.x;
  const dy = snapped.bounds.y - after.y;

  let touched = false;
  const next = elements.map((element) => {
    const box = moving.get(element.id);
    if (!box) return element;
    const target = resizing ? snapped.bounds : { ...box, x: box.x + dx, y: box.y + dy };
    if (
      Math.abs(target.x - element.x) < GEOMETRY_EPSILON
      && Math.abs(target.y - element.y) < GEOMETRY_EPSILON
      && Math.abs(target.width - element.width) < GEOMETRY_EPSILON
      && Math.abs(target.height - element.height) < GEOMETRY_EPSILON
    ) return element;
    touched = true;
    return { ...element, x: target.x, y: target.y, width: target.width, height: target.height };
  });
  return { elements: touched ? next : elements, guides: snapped.guides };
}

/**
 * Undo/redo for one editing session. A drag reports an edit per frame, so edits closer
 * together than the coalescing window fold into a single undo step; the stack is capped
 * because a canvas snapshot is the whole element array.
 */
export const PRESENTATION_HISTORY_COALESCE_MS = 350;
export const PRESENTATION_HISTORY_LIMIT = 50;

export type PresentationSnapshot = { elements: PresentationElement[]; steps: PresentationStep[] };

export type PresentationCanvasState = PresentationSnapshot & {
  /** Background and playback settings are saved with the canvas, so they belong to the
   * same dirty/saved bookkeeping as the elements -- otherwise a background picked while a
   * save is in flight looks saved and never reaches the server. */
  background: string;
  settings: PresentationSettings;
  /** Alignment lines to draw for the gesture in progress. */
  guides: SnapGuide[];
  past: PresentationSnapshot[];
  future: PresentationSnapshot[];
  /** Set by every edit, cleared once that exact canvas has been written to the server. */
  dirty: boolean;
  /** The last write failed and nothing has been edited since: the autosave stays parked
   * here instead of retrying the same doomed save every debounce. */
  failed: boolean;
  editedAt: number;
};

export type PresentationCanvasAction =
  | {
    type: "edit";
    at: number;
    elements?: (current: PresentationElement[]) => PresentationElement[];
    steps?: (current: PresentationStep[]) => PresentationStep[];
  }
  | { type: "geometry"; at: number; changes: PresentationGeometryChange[]; tolerance: number; gesture: boolean }
  | { type: "undo" }
  | { type: "redo" }
  /** Marks the canvas clean, but only if it is still the one that was saved. */
  | {
    type: "saved";
    elements: PresentationElement[];
    steps: PresentationStep[];
    background: string;
    settings: PresentationSettings;
  }
  /** Background and playback settings: edits that carry no undo step of their own. */
  | { type: "touch"; background?: string; settings?: Partial<PresentationSettings> }
  | { type: "failed" };

export function initialPresentationCanvasState(
  elements: PresentationElement[],
  steps: PresentationStep[],
  background = "",
  settings: PresentationSettings = defaultPresentationSettings,
): PresentationCanvasState {
  return { elements, steps, background, settings, guides: [], past: [], future: [], dirty: false, failed: false, editedAt: 0 };
}

function commitCanvas(
  state: PresentationCanvasState,
  elements: PresentationElement[],
  steps: PresentationStep[],
  at: number,
): PresentationCanvasState {
  if (elements === state.elements && steps === state.steps) return state;
  const coalesce = state.past.length > 0 && at - state.editedAt <= PRESENTATION_HISTORY_COALESCE_MS;
  return {
    ...state,
    elements,
    steps,
    dirty: true,
    failed: false,
    editedAt: at,
    past: coalesce ? state.past : [...state.past, { elements: state.elements, steps: state.steps }].slice(-PRESENTATION_HISTORY_LIMIT),
    future: coalesce ? state.future : [],
  };
}

function travelCanvas(state: PresentationCanvasState, direction: "undo" | "redo"): PresentationCanvasState {
  const source = direction === "undo" ? state.past : state.future;
  if (!source.length) return state;
  const snapshot = source[source.length - 1];
  const current: PresentationSnapshot = { elements: state.elements, steps: state.steps };
  return {
    ...state,
    elements: snapshot.elements,
    steps: snapshot.steps,
    guides: [],
    past: direction === "undo" ? source.slice(0, -1) : [...state.past, current],
    future: direction === "undo" ? [...state.future, current] : source.slice(0, -1),
    dirty: true,
    failed: false,
    // The next edit opens its own undo step rather than coalescing into the one just undone.
    editedAt: 0,
  };
}

export function presentationCanvasReducer(
  state: PresentationCanvasState,
  action: PresentationCanvasAction,
): PresentationCanvasState {
  switch (action.type) {
    case "edit":
      return commitCanvas(
        state,
        action.elements ? action.elements(state.elements) : state.elements,
        action.steps ? action.steps(state.steps) : state.steps,
        action.at,
      );
    case "geometry": {
      const result = applyGeometryChanges(state.elements, action.changes, action.tolerance);
      const next = commitCanvas(state, result.elements, state.steps, action.at);
      const guides = action.gesture ? result.guides : [];
      if (next === state && !guides.length && !state.guides.length) return state;
      return { ...next, guides };
    }
    case "undo":
    case "redo":
      return travelCanvas(state, action.type);
    case "saved": {
      // Anything the author changed while the write was in flight keeps the canvas dirty,
      // so the follow-up autosave carries it to the server.
      const current = state.elements === action.elements
        && state.steps === action.steps
        && state.background === action.background
        && state.settings === action.settings;
      return current ? { ...state, dirty: false, failed: false } : state;
    }
    case "touch": {
      const background = action.background ?? state.background;
      const settings = action.settings ? { ...state.settings, ...action.settings } : state.settings;
      if (background === state.background && settings === state.settings) return state;
      return { ...state, background, settings, dirty: true, failed: false };
    }
    case "failed":
      return state.failed ? state : { ...state, failed: true };
  }
}

/** Rotation stays in the schema's [-360, 360] window and reads as the shortest turn. */
export function normalizeRotation(degrees: number): number {
  return Math.round((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * Turn a selection around one point: every element spins on its own centre *and* orbits
 * the shared centre, so a group keeps its arrangement. For a single element the two
 * centres coincide and it simply spins in place.
 */
export function rotateElements(
  elements: PresentationElement[],
  ids: Set<string>,
  deltaDegrees: number,
  center: { x: number; y: number },
): PresentationElement[] {
  const radians = (deltaDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return elements.map((element) => {
    if (!ids.has(element.id)) return element;
    const dx = element.x + element.width / 2 - center.x;
    const dy = element.y + element.height / 2 - center.y;
    return {
      ...element,
      x: center.x + dx * cos - dy * sin - element.width / 2,
      y: center.y + dx * sin + dy * cos - element.height / 2,
      rotation: normalizeRotation(element.rotation + deltaDegrees),
    };
  });
}

/** Scale a selection about `origin` (the anchor corner held still by the drag). */
export function scaleElements(
  elements: PresentationElement[],
  ids: Set<string>,
  origin: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): PresentationElement[] {
  if (!(scaleX > 0) || !(scaleY > 0)) return elements;
  // ponytail: the box scales, the font size does not — same as single-element resize.
  return elements.map((element) =>
    ids.has(element.id)
      ? {
        ...element,
        x: origin.x + (element.x - origin.x) * scaleX,
        y: origin.y + (element.y - origin.y) * scaleY,
        width: Math.max(element.width * scaleX, PRESENTATION_MIN_ELEMENT_SIZE),
        height: Math.max(element.height * scaleY, PRESENTATION_MIN_ELEMENT_SIZE),
      }
      : element,
  );
}

export function stepLabel(element: PresentationElement, index: number): string {
  const raw =
    element.type === "frame" ? element.content.label
      : element.type === "text" ? element.content.text
        : element.type === "image" ? element.content.alt
          // A shape has no words of its own, so it is named by its position in the path.
          : "";
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 60) : `${index + 1}`;
}
