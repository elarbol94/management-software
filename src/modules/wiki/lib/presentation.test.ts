import { describe, expect, it } from "vitest";
import {
  PRESENTATION_CAMERA_PADDING,
  PRESENTATION_LEASE_TIMEOUT_MS,
  PRESENTATION_PAGE_SIZE,
  PRESENTATION_REVISION_THROTTLE_MS,
  defaultPresentationSettings,
  duplicateElement,
  elementBounds,
  elementsWithinStep,
  fitBoundsToPage,
  isLeaseHeldByOther,
  moveStep,
  normalizeSteps,
  parsePresentationCanvas,
  presentationCameraEasingFns,
  reorderElement,
  resolveStepDuration,
  shouldSnapshotRevision,
  stepLabel,
  stepTarget,
  unionBounds,
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
