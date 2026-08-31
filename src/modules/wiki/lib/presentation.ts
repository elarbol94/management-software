import { z } from "zod";

/**
 * A presentation is a single infinite canvas plus an ordered path across it. Elements
 * carry their own geometry; a step is only a reference to one of them, so moving or
 * resizing an element automatically moves the camera target that points at it.
 */

export const presentationFrameShapes = ["rect", "circle", "none"] as const;
export type PresentationFrameShape = (typeof presentationFrameShapes)[number];

export const presentationElementTypes = ["text", "image", "frame"] as const;
export type PresentationElementType = (typeof presentationElementTypes)[number];

const geometrySchema = {
  id: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(20).max(20_000),
  height: z.number().finite().min(20).max(20_000),
  rotation: z.number().finite().min(-360).max(360).default(0),
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

export const presentationElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  imageElementSchema,
  frameElementSchema,
]);
export type PresentationElement = z.infer<typeof presentationElementSchema>;
export type PresentationTextElement = z.infer<typeof textElementSchema>;
export type PresentationImageElement = z.infer<typeof imageElementSchema>;
export type PresentationFrameElement = z.infer<typeof frameElementSchema>;

export const presentationStepSchema = z.object({
  id: z.string().min(1).max(64),
  elementId: z.string().min(1).max(64),
});
export type PresentationStep = z.infer<typeof presentationStepSchema>;

export const presentationElementsSchema = presentationElementSchema.array().max(500);
export const presentationStepsSchema = presentationStepSchema.array().max(500);

export type PresentationBounds = { x: number; y: number; width: number; height: number };

/** Padding around a step target, as a share of the target's size. */
export const PRESENTATION_CAMERA_PADDING = 0.12;

export function parsePresentationElements(json: string): PresentationElement[] {
  try {
    return presentationElementsSchema.parse(JSON.parse(json));
  } catch {
    return [];
  }
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

export function stepLabel(element: PresentationElement, index: number): string {
  const raw =
    element.type === "frame" ? element.content.label
      : element.type === "text" ? element.content.text
        : element.content.alt;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 60) : `${index + 1}`;
}
