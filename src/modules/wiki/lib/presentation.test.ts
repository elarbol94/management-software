import { describe, expect, it } from "vitest";
import {
  PRESENTATION_CAMERA_PADDING,
  PRESENTATION_PAGE_SIZE,
  elementBounds,
  fitBoundsToPage,
  moveStep,
  normalizeSteps,
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

describe("presentation step labels", () => {
  it("prefers the frame label", () => {
    expect(stepLabel(frame("a", 0, 0, 10, 10, "  Ergebnisse  "), 0)).toBe("Ergebnisse");
  });

  it("falls back to the step number when there is nothing to name it by", () => {
    expect(stepLabel(frame("a", 0, 0, 10, 10), 4)).toBe("5");
  });

  it("collapses whitespace in a text element's own content", () => {
    expect(stepLabel(text("a", "Zwei\n  Zeilen"), 0)).toBe("Zwei Zeilen");
  });
});
