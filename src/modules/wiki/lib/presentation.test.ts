import { describe, expect, it } from "vitest";
import {
  duplicateElement,
  elementBounds,
  moveStep,
  normalizeSteps,
  parsePresentationCanvas,
  reorderElement,
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
    expect(parsePresentationCanvas(legacy)).toEqual({ elements: [frame("a", 0, 0, 100, 100)], background: "" });
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
    expect(parsePresentationCanvas("not json")).toEqual({ elements: [], background: "" });
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
