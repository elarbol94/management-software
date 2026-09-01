import { describe, expect, it } from "vitest";
import {
  PRESENTATION_CAMERA_PADDING,
  PRESENTATION_HISTORY_COALESCE_MS,
  PRESENTATION_HISTORY_LIMIT,
  PRESENTATION_LEASE_TIMEOUT_MS,
  PRESENTATION_MIN_ELEMENT_SIZE,
  PRESENTATION_PAGE_SIZE,
  PRESENTATION_REVISION_THROTTLE_MS,
  defaultPresentationSettings,
  duplicateElement,
  elementBounds,
  elementsWithinStep,
  fitBoundsToPage,
  initialPresentationCanvasState,
  isLeaseHeldByOther,
  moveStep,
  normalizeRotation,
  normalizeSteps,
  parsePresentationCanvas,
  presentationCameraEasingFns,
  presentationCanvasReducer,
  reorderElement,
  retargetStep,
  rotateElements,
  scaleElements,
  resolveStepDuration,
  shouldSnapshotRevision,
  snapBounds,
  stepLabel,
  stepTarget,
  unionBounds,
  type PresentationCanvasState,
  type PresentationElement,
  type PresentationStep,
} from "./presentation";

function frame(id: string, x: number, y: number, width: number, height: number, label = ""): PresentationElement {
  return { id, type: "frame", x, y, width, height, rotation: 0, content: { label, shape: "rect", color: "" } };
}

function text(id: string, value: string): PresentationElement {
  return {
    id, type: "text", x: 0, y: 0, width: 100, height: 40, rotation: 0,
    content: { text: value, fontSize: 32, bold: false, color: "", align: "left" },
  };
}

const steps = (...elementIds: string[]): PresentationStep[] =>
  elementIds.map((elementId, index) => ({ id: `s${index}`, elementId }));

describe("presentation camera targets", () => {
  it("derives a step's camera target from the element's own bounds", () => {
    expect(elementBounds(frame("a", -120, 40, 640, 360))).toEqual({ x: -120, y: 40, width: 640, height: 360 });
  });

  it("keeps a nested frame's target independent of the frame around it", () => {
    // The Prezi signature: zooming to the small frame must not inherit the outer scale.
    const outer = frame("outer", 0, 0, 2000, 1200);
    const inner = frame("inner", 900, 500, 120, 80);
    expect(elementBounds(inner)).toEqual({ x: 900, y: 500, width: 120, height: 80 });
    expect(elementBounds(outer).width / elementBounds(inner).width).toBeCloseTo(16.67, 1);
  });

  it("spans every element for the overview", () => {
    expect(unionBounds([frame("a", 0, 0, 100, 100), frame("b", -50, 200, 100, 100)])).toEqual({
      x: -50, y: 0, width: 150, height: 300,
    });
  });

  it("has no overview bounds on an empty canvas", () => {
    expect(unionBounds([])).toBeNull();
  });
});

describe("presentation path ordering", () => {
  const elements = [frame("a", 0, 0, 100, 100), frame("b", 0, 0, 100, 100), frame("c", 0, 0, 100, 100)];

  it("moves a step to a later position", () => {
    expect(moveStep(steps("a", "b", "c"), 0, 2).map((step) => step.elementId)).toEqual(["b", "c", "a"]);
  });

  it("moves a step to an earlier position", () => {
    expect(moveStep(steps("a", "b", "c"), 2, 0).map((step) => step.elementId)).toEqual(["c", "a", "b"]);
  });

  it("leaves the order alone for a no-op or out-of-range move", () => {
    const original = steps("a", "b", "c");
    expect(moveStep(original, 1, 1)).toBe(original);
    expect(moveStep(original, 0, 9)).toBe(original);
    expect(moveStep(original, -1, 0)).toBe(original);
  });

  it("drops steps whose element was deleted", () => {
    const path = [...steps("a", "b"), { id: "s2", elementId: "gone" }];
    expect(normalizeSteps(path, elements).map((step) => step.elementId)).toEqual(["a", "b"]);
  });

  it("drops duplicate step ids", () => {
    const path: PresentationStep[] = [{ id: "s0", elementId: "a" }, { id: "s0", elementId: "b" }];
    expect(normalizeSteps(path, elements)).toEqual([{ id: "s0", elementId: "a" }]);
  });

  it("keeps the same element usable as more than one step", () => {
    expect(normalizeSteps(steps("a", "b", "a"), elements)).toHaveLength(3);
  });

  it("resolves a step to its element, or to nothing once it is gone", () => {
    expect(stepTarget({ id: "s0", elementId: "b" }, elements)?.id).toBe("b");
    expect(stepTarget({ id: "s0", elementId: "gone" }, elements)).toBeNull();
  });
});

describe("presentation z-order", () => {
  const ids = (elements: PresentationElement[]) => elements.map((element) => element.id);
  const elements = [frame("a", 0, 0, 100, 100), frame("b", 0, 0, 100, 100), frame("c", 0, 0, 100, 100)];

  it("brings an element to the end of the array, where it paints on top", () => {
    expect(ids(reorderElement(elements, "a", "front"))).toEqual(["b", "c", "a"]);
  });

  it("sends an element to the start of the array", () => {
    expect(ids(reorderElement(elements, "c", "back"))).toEqual(["c", "a", "b"]);
  });

  it("leaves the order and the array alone for an unknown element", () => {
    expect(reorderElement(elements, "gone", "front")).toBe(elements);
  });

  it("keeps the array length no matter how often an element is reordered", () => {
    expect(reorderElement(reorderElement(elements, "b", "front"), "b", "back")).toHaveLength(3);
  });
});

describe("presentation duplication", () => {
  const original = text("a", "Hallo");

  it("offsets the copy so it does not hide under the original", () => {
    const { element } = duplicateElement([original], "a", "copy");
    expect(element).toMatchObject({ id: "copy", x: original.x + 24, y: original.y + 24 });
  });

  it("appends the copy so it lands on top, and does not touch the original", () => {
    const { elements } = duplicateElement([original], "a", "copy");
    expect(elements.map((element) => element.id)).toEqual(["a", "copy"]);
    expect(elements[0]).toBe(original);
  });

  it("copies the content instead of sharing it with the original", () => {
    const { element } = duplicateElement([original], "a", "copy");
    expect(element?.content).not.toBe(original.content);
    expect(element?.content).toEqual(original.content);
  });

  it("does nothing for an unknown element", () => {
    const source = [original];
    expect(duplicateElement(source, "gone", "copy")).toEqual({ elements: source, element: null });
  });
});

describe("presentation canvas envelope", () => {
  it("still reads a canvas saved as a bare element array", () => {
    const legacy = JSON.stringify([{ ...frame("a", 0, 0, 100, 100) }]);
    expect(parsePresentationCanvas(legacy)).toEqual({
      elements: [frame("a", 0, 0, 100, 100)],
      background: "",
      settings: defaultPresentationSettings,
    });
  });

  it("reads the envelope with its canvas background", () => {
    const saved = JSON.stringify({ elements: [frame("a", 0, 0, 100, 100)], background: "#101828" });
    expect(parsePresentationCanvas(saved).background).toBe("#101828");
  });

  it("keeps a shape element with all of its drawing properties", () => {
    const shape: PresentationElement = {
      id: "s", type: "shape", x: 0, y: 0, width: 200, height: 120, rotation: 45,
      content: { shape: "arrow", fill: "#ffffff", stroke: "#e11d48", strokeWidth: 4, opacity: 0.5 },
    };
    const parsed = parsePresentationCanvas(JSON.stringify({ elements: [shape] }));
    expect(parsed.elements[0]).toEqual(shape);
  });

  it("falls back to an empty canvas rather than throwing on unreadable JSON", () => {
    expect(parsePresentationCanvas("not json")).toEqual({
      elements: [],
      background: "",
      settings: defaultPresentationSettings,
    });
  });
});

describe("presentation page export transform", () => {
  const page = { width: 1000, height: 500 };
  const project = (
    point: { x: number; y: number },
    transform: { scale: number; offsetX: number; offsetY: number },
  ) => ({
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  });

  it("centres the step's target on the page", () => {
    const bounds = { x: 200, y: -100, width: 400, height: 200 };
    const transform = fitBoundsToPage(bounds, page, 0);
    expect(project({ x: 400, y: 0 }, transform)).toEqual({ x: 500, y: 250 });
  });

  it("fits the constraining side and leaves the other with slack", () => {
    // A tall target on a wide page is limited by height, not width.
    const transform = fitBoundsToPage({ x: 0, y: 0, width: 100, height: 500 }, page, 0);
    expect(transform.scale).toBe(1);
    expect(project({ x: 0, y: 0 }, transform)).toEqual({ x: 450, y: 0 });
    expect(project({ x: 100, y: 500 }, transform)).toEqual({ x: 550, y: 500 });
  });

  it("keeps the padded target inside the page", () => {
    const bounds = { x: -50, y: 40, width: 800, height: 600 };
    const transform = fitBoundsToPage(bounds, page);
    const topLeft = project(bounds, transform);
    const bottomRight = project({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, transform);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(page.width);
    expect(bottomRight.y).toBeLessThanOrEqual(page.height);
    // Height is the constraining side here, and the padding it leaves is the player's,
    // so a printed page frames a step exactly as the screen does.
    expect((bottomRight.y - topLeft.y) / page.height).toBeCloseTo(1 / (1 + PRESENTATION_CAMERA_PADDING), 5);
  });

  it("does not divide by zero on a degenerate target", () => {
    const transform = fitBoundsToPage({ x: 0, y: 0, width: 0, height: 0 }, page, 0);
    expect(Number.isFinite(transform.scale)).toBe(true);
    expect(project({ x: 0, y: 0 }, transform)).toEqual({ x: 500, y: 250 });
  });

  it("defaults to an A4 landscape page", () => {
    expect(PRESENTATION_PAGE_SIZE.width).toBeGreaterThan(PRESENTATION_PAGE_SIZE.height);
    const transform = fitBoundsToPage(elementBounds(frame("a", 0, 0, 640, 400)));
    expect(project({ x: 320, y: 200 }, transform)).toEqual({
      x: PRESENTATION_PAGE_SIZE.width / 2,
      y: PRESENTATION_PAGE_SIZE.height / 2,
    });
  });
});

describe("presentation camera easing", () => {
  it("keeps every easing curve anchored at its endpoints", () => {
    for (const ease of Object.values(presentationCameraEasingFns)) {
      expect(ease(0)).toBeCloseTo(0, 5);
      expect(ease(1)).toBeCloseTo(1, 5);
    }
  });

  it("gives the new back-ease transition a distinct overshoot feel", () => {
    const ease = presentationCameraEasingFns["ease-out-back"];
    // Somewhere near the end it swings past 1 before settling — the "pop" that sets it
    // apart from the other, purely monotonic curves.
    const overshoots = Array.from({ length: 20 }, (_, i) => ease((i + 1) / 20)).some((value) => value > 1);
    expect(overshoots).toBe(true);
    expect(presentationCameraEasingFns["ease-in-out"](0.9)).toBeLessThanOrEqual(1);
  });
});

describe("presentation step labels", () => {
  it("prefers the frame label", () => {
    expect(stepLabel(frame("a", 0, 0, 10, 10, "  Ergebnisse  "), 0)).toBe("Ergebnisse");
  });

  it("falls back to the step number when there is nothing to name it by", () => {
    expect(stepLabel(frame("a", 0, 0, 10, 10), 4)).toBe("5");
  });

  it("names a wordless shape by its step number", () => {
    const shape: PresentationElement = {
      id: "s", type: "shape", x: 0, y: 0, width: 200, height: 120, rotation: 0,
      content: { shape: "line", fill: "", stroke: "", strokeWidth: 2, opacity: 1 },
    };
    expect(stepLabel(shape, 2)).toBe("3");
  });

  it("collapses whitespace in a text element's own content", () => {
    expect(stepLabel(text("a", "Zwei\n  Zeilen"), 0)).toBe("Zwei Zeilen");
  });
});

describe("presentation revision throttle", () => {
  const now = 1_700_000_000_000;

  it("always snapshots the first save", () => {
    expect(shouldSnapshotRevision(null, now)).toBe(true);
  });

  it("skips a snapshot inside the throttle window", () => {
    expect(shouldSnapshotRevision(now - PRESENTATION_REVISION_THROTTLE_MS, now)).toBe(false);
    expect(shouldSnapshotRevision(now - 1_000, now)).toBe(false);
  });

  it("snapshots again once the window has passed", () => {
    expect(shouldSnapshotRevision(now - PRESENTATION_REVISION_THROTTLE_MS - 1, now)).toBe(true);
  });
});

describe("presentation edit lease", () => {
  const now = 1_700_000_000_000;
  const lease = (sessionId: string, heartbeatAt: number) => ({ sessionId, heartbeatAt });

  it("is free when nobody holds it", () => {
    expect(isLeaseHeldByOther(null, "mine", now)).toBe(false);
  });

  it("never locks out the session that holds it", () => {
    expect(isLeaseHeldByOther(lease("mine", now), "mine", now)).toBe(false);
  });

  it("locks out another live session", () => {
    expect(isLeaseHeldByOther(lease("theirs", now - 10_000), "mine", now)).toBe(true);
  });

  it("releases an expired lease", () => {
    expect(isLeaseHeldByOther(lease("theirs", now - PRESENTATION_LEASE_TIMEOUT_MS), "mine", now)).toBe(true);
    expect(isLeaseHeldByOther(lease("theirs", now - PRESENTATION_LEASE_TIMEOUT_MS - 1), "mine", now)).toBe(false);
  });
});

describe("autoplay step duration", () => {
  it("uses the presentation's default when a step has no override", () => {
    const step: PresentationStep = { id: "s0", elementId: "a" };
    expect(resolveStepDuration(step, defaultPresentationSettings)).toBe(defaultPresentationSettings.defaultStepDurationMs);
  });

  it("prefers a step's own duration over the default", () => {
    const step: PresentationStep = { id: "s0", elementId: "a", durationMs: 9_000 };
    expect(resolveStepDuration(step, defaultPresentationSettings)).toBe(9_000);
  });
});

describe("presentation canvas settings", () => {
  it("falls back to default settings for a legacy bare elements array", () => {
    const parsed = parsePresentationCanvas(JSON.stringify([frame("a", 0, 0, 100, 100)]));
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.settings).toEqual(defaultPresentationSettings);
  });

  it("reads settings saved alongside the elements", () => {
    const parsed = parsePresentationCanvas(
      JSON.stringify({ elements: [], settings: { loop: true, defaultStepDurationMs: 6_000 } }),
    );
    expect(parsed.settings.loop).toBe(true);
    expect(parsed.settings.defaultStepDurationMs).toBe(6_000);
    // Fields left out of a partial settings object still get their defaults.
    expect(parsed.settings.cameraEasing).toBe("ease-in-out");
  });

  it("recovers with defaults from unparsable canvas JSON", () => {
    expect(parsePresentationCanvas("not json")).toEqual({
      elements: [],
      background: "",
      settings: defaultPresentationSettings,
    });
  });
});

describe("step entrance grouping", () => {
  it("fades in everything nested inside the target frame", () => {
    const target = frame("outer", 0, 0, 400, 300);
    const inside = frame("inner", 50, 50, 100, 100);
    const outside = frame("elsewhere", 1000, 1000, 50, 50);
    const ids = elementsWithinStep(target, [target, inside, outside]).map((element) => element.id);
    expect(ids).toEqual(["outer", "inner"]);
  });

  it("includes at least the target itself when nothing else is nested inside it", () => {
    const target = text("solo", "Hello");
    expect(elementsWithinStep(target, [target]).map((element) => element.id)).toEqual(["solo"]);
  });
});

describe("alignment snapping", () => {
  const box = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height });

  it("pulls a dragged element flush to another element's edge", () => {
    const result = snapBounds(box(0, 0), box(304, 0), [box(300, 500)], 6);
    expect(result.bounds.x).toBe(300);
    expect(result.guides).toContainEqual(expect.objectContaining({ axis: "x", position: 300 }));
  });

  it("aligns centres, and prefers the nearer line when both are in range", () => {
    // Left edge is 5 away from the target's left, centre is 1 away from its centre.
    const result = snapBounds(box(0, 0), box(295, 0), [box(300, 0, 90, 100)], 6);
    expect(result.bounds.x + result.bounds.width / 2).toBe(345);
  });

  it("leaves a drag alone when nothing is within reach", () => {
    const result = snapBounds(box(0, 0), box(340, 0), [box(300, 500)], 6);
    expect(result.bounds).toEqual(box(340, 0));
    expect(result.guides).toEqual([]);
  });

  it("snaps into and back out of a frame's edge", () => {
    const frameBox = box(0, 0, 800, 600);
    const inside = snapBounds(box(1000, 1000, 100, 100), box(4, 3, 100, 100), [frameBox], 6).bounds;
    expect(inside).toEqual(box(0, 0));
    const out = snapBounds(inside, box(60, 60, 100, 100), [frameBox], 6).bounds;
    expect(out).toEqual(box(60, 60));
  });

  it("moves only the dragged edge while resizing", () => {
    // Right edge dragged to 297; the target's left edge at 300 pulls it, x stays put.
    const result = snapBounds(box(100, 100, 100, 100), box(100, 100, 197, 100), [box(300, 100)], 6);
    expect(result.bounds).toEqual(box(100, 100, 200, 100));
  });

  it("keeps the far edge still when the near edge snaps during a resize", () => {
    const result = snapBounds(box(100, 0, 400, 100), box(304, 0, 196, 100), [box(300, 0)], 6);
    expect(result.bounds.x).toBe(300);
    expect(result.bounds.x + result.bounds.width).toBe(500);
  });

  it("never resizes below the minimum element size", () => {
    const result = snapBounds(box(0, 0, 100, 100), box(0, 0, 42, 100), [box(0, 0, 20, 100)], 30);
    expect(result.bounds.width).toBe(PRESENTATION_MIN_ELEMENT_SIZE);
  });
});

describe("selection transforms", () => {
  it("spins a single element in place", () => {
    const element = { ...frame("a", 0, 0, 100, 200), rotation: 10 };
    const [rotated] = rotateElements([element], new Set(["a"]), 35, { x: 50, y: 100 });
    expect(rotated.rotation).toBe(45);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(0);
  });

  it("orbits a group around the shared centre", () => {
    const elements = [frame("a", 0, 0, 100, 100), frame("b", 200, 0, 100, 100)];
    const rotated = rotateElements(elements, new Set(["a", "b"]), 90, { x: 150, y: 50 });
    // A quarter turn about the midpoint swaps the two horizontally-placed boxes vertically.
    expect(rotated[0].x).toBeCloseTo(100);
    expect(rotated[0].y).toBeCloseTo(-100);
    expect(rotated[1].rotation).toBe(90);
  });

  it("leaves unselected elements untouched", () => {
    const elements = [frame("a", 0, 0, 100, 100), frame("b", 500, 500, 100, 100)];
    expect(rotateElements(elements, new Set(["a"]), 90, { x: 50, y: 50 })[1]).toBe(elements[1]);
    expect(scaleElements(elements, new Set(["a"]), { x: 0, y: 0 }, 2, 2)[1]).toBe(elements[1]);
  });

  it("wraps rotation into the schema's window", () => {
    expect(normalizeRotation(370)).toBe(10);
    expect(normalizeRotation(-370)).toBe(-10);
    expect(normalizeRotation(180)).toBe(-180);
  });

  it("scales a group about the held corner", () => {
    const elements = [frame("a", 100, 100, 100, 100), frame("b", 300, 100, 100, 100)];
    const scaled = scaleElements(elements, new Set(["a", "b"]), { x: 100, y: 100 }, 2, 0.5);
    expect(scaled[0]).toMatchObject({ x: 100, y: 100, width: 200, height: 50 });
    expect(scaled[1]).toMatchObject({ x: 500, y: 100, width: 200, height: 50 });
  });

  it("refuses a degenerate scale rather than collapsing the canvas", () => {
    const elements = [frame("a", 0, 0, 100, 100)];
    expect(scaleElements(elements, new Set(["a"]), { x: 0, y: 0 }, 0, 1)).toBe(elements);
  });
});

describe("step retargeting", () => {
  it("points a step at another element while keeping its notes and duration", () => {
    const original: PresentationStep[] = [{ id: "s0", elementId: "a", durationMs: 3_000, notes: "hi" }];
    expect(retargetStep(original, "s0", "b")).toEqual([{ id: "s0", elementId: "b", durationMs: 3_000, notes: "hi" }]);
  });

  it("ignores an unknown step", () => {
    expect(retargetStep(steps("a"), "nope", "b")).toEqual(steps("a"));
  });
});

describe("canvas history", () => {
  const start = () => initialPresentationCanvasState([frame("a", 0, 0, 100, 100)], steps("a"));
  const move = (state: PresentationCanvasState, x: number, at: number) =>
    presentationCanvasReducer(state, {
      type: "geometry", at, gesture: true, tolerance: 6, changes: [{ id: "a", x, y: 0 }],
    });

  it("undoes and redoes an edit", () => {
    const moved = move(start(), 400, 1_000);
    expect(moved.elements[0].x).toBe(400);
    expect(moved.dirty).toBe(true);
    const undone = presentationCanvasReducer(moved, { type: "undo" });
    expect(undone.elements[0].x).toBe(0);
    expect(presentationCanvasReducer(undone, { type: "redo" }).elements[0].x).toBe(400);
  });

  it("folds one drag into a single undo step", () => {
    let state = start();
    for (let frameIndex = 1; frameIndex <= 10; frameIndex += 1) state = move(state, frameIndex * 40, 1_000 + frameIndex * 16);
    expect(state.past).toHaveLength(1);
    expect(presentationCanvasReducer(state, { type: "undo" }).elements[0].x).toBe(0);
  });

  it("opens a new undo step once the author pauses", () => {
    const first = move(start(), 400, 1_000);
    expect(move(first, 800, 1_000 + PRESENTATION_HISTORY_COALESCE_MS + 1).past).toHaveLength(2);
  });

  it("drops the redo stack as soon as a new edit lands", () => {
    const undone = presentationCanvasReducer(move(start(), 400, 1_000), { type: "undo" });
    expect(undone.future).toHaveLength(1);
    expect(move(undone, 90, 2_000).future).toEqual([]);
  });

  it("caps the stack rather than growing without bound", () => {
    let state = start();
    for (let step = 1; step <= PRESENTATION_HISTORY_LIMIT + 20; step += 1) {
      state = move(state, step, step * (PRESENTATION_HISTORY_COALESCE_MS + 1));
    }
    expect(state.past).toHaveLength(PRESENTATION_HISTORY_LIMIT);
  });

  it("does nothing at the ends of the stack", () => {
    const state = start();
    expect(presentationCanvasReducer(state, { type: "undo" })).toBe(state);
    expect(presentationCanvasReducer(state, { type: "redo" })).toBe(state);
  });

  it("ignores the dimensions the canvas measures on mount", () => {
    const state = start();
    const measured = presentationCanvasReducer(state, {
      type: "geometry", at: 1_000, gesture: false, tolerance: 6,
      changes: [{ id: "a", width: 100.2, height: 99.8 }],
    });
    expect(measured).toBe(state);
    expect(measured.dirty).toBe(false);
  });

  it("stays clean only while the saved canvas is still the current one", () => {
    const moved = move(start(), 400, 1_000);
    expect(presentationCanvasReducer(moved, { type: "saved", elements: moved.elements, steps: moved.steps }).dirty).toBe(false);
    const later = move(moved, 900, 5_000);
    expect(presentationCanvasReducer(later, { type: "saved", elements: moved.elements, steps: moved.steps }).dirty).toBe(true);
  });

  it("snaps a dragged element to a neighbour and reports the guide", () => {
    const state = initialPresentationCanvasState(
      [frame("a", 0, 0, 100, 100), frame("b", 400, 0, 100, 100)],
      [],
    );
    const dragged = move(state, 396, 1_000);
    expect(dragged.elements[0].x).toBe(400);
    // Both boxes sit at y = 0, so the horizontal edges line up as well.
    expect(dragged.guides).toContainEqual(expect.objectContaining({ axis: "x", position: 400 }));
    expect(dragged.guides).toContainEqual(expect.objectContaining({ axis: "y", position: 0 }));
    // The gesture ending clears the guides without touching the canvas.
    const released = presentationCanvasReducer(dragged, {
      type: "geometry", at: 1_100, gesture: false, tolerance: 6, changes: [{ id: "a", x: 400, y: 0 }],
    });
    expect(released.guides).toEqual([]);
    expect(released.elements).toBe(dragged.elements);
  });

  it("moves a whole selection by the same offset", () => {
    const state = initialPresentationCanvasState(
      [frame("a", 0, 0, 100, 100), frame("b", 200, 0, 100, 100)],
      [],
    );
    const dragged = presentationCanvasReducer(state, {
      type: "geometry", at: 1_000, gesture: true, tolerance: 6,
      changes: [{ id: "a", x: 50, y: 30 }, { id: "b", x: 250, y: 30 }],
    });
    expect(dragged.elements.map((element) => [element.x, element.y])).toEqual([[50, 30], [250, 30]]);
  });
});
