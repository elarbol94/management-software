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

export const presentationCameraEasings = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;
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

export function unionBounds(elements: PresentationElement[]): PresentationBounds | null {
  if (!elements.length) return null;
  const left = Math.min(...elements.map((element) => element.x));
  const top = Math.min(...elements.map((element) => element.y));
  const right = Math.max(...elements.map((element) => element.x + element.width));
  const bottom = Math.max(...elements.map((element) => element.y + element.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
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
