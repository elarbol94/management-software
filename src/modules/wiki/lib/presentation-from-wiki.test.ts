import { describe, expect, it } from "vitest";
import { presentationFromWikiPage } from "./presentation-from-wiki";
import { elementsWithinStep, presentationElementsSchema, presentationStepsSchema } from "./presentation";

function heading(level: number, text: string) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function image(attachmentId: string, alt = "") {
  return { type: "commentableImage", attrs: { attachmentId, alt } };
}

function doc(content: unknown[]) {
  return JSON.stringify({ type: "doc", content });
}

describe("presentationFromWikiPage", () => {
  it("falls back to a single frame using the page title when there are no headings", () => {
    const { elements, steps } = presentationFromWikiPage({
      title: "My Page",
      contentJson: doc([{ type: "paragraph", content: [{ type: "text", text: "just prose" }] }]),
    });
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe("frame");
    expect(elements[0].type === "frame" && elements[0].content.label).toBe("My Page");
    expect(steps).toHaveLength(1);
    expect(steps[0].elementId).toBe(elements[0].id);
  });

  it("falls back for an empty document", () => {
    const { elements } = presentationFromWikiPage({ title: "Empty", contentJson: "" });
    expect(elements).toHaveLength(1);
    expect(elements[0].type === "frame" && elements[0].content.label).toBe("Empty");
  });

  it("turns a flat list of H1 headings into sibling top-level frames", () => {
    const { elements, steps } = presentationFromWikiPage({
      title: "Doc",
      contentJson: doc([heading(1, "Intro"), heading(1, "Body"), heading(1, "Conclusion")]),
    });
    const frames = elements.filter((element) => element.type === "frame");
    expect(frames.map((frame) => frame.type === "frame" && frame.content.label)).toEqual(["Intro", "Body", "Conclusion"]);
    expect(steps).toHaveLength(3);
    // Siblings must not overlap on the canvas.
    const sorted = [...frames].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width);
    }
  });

  it("nests H2 headings inside their parent H1 frame", () => {
    const { elements } = presentationFromWikiPage({
      title: "Doc",
      contentJson: doc([heading(1, "Chapter 1"), heading(2, "Section 1.1"), heading(2, "Section 1.2"), heading(1, "Chapter 2")]),
    });
    const byLabel = new Map(
      elements.filter((el) => el.type === "frame").map((el) => [el.type === "frame" ? el.content.label : "", el]),
    );
    const chapter1 = byLabel.get("Chapter 1")!;
    const section11 = byLabel.get("Section 1.1")!;
    const section12 = byLabel.get("Section 1.2")!;
    const chapter2 = byLabel.get("Chapter 2")!;

    // Both sub-sections must be fully contained within Chapter 1's bounds.
    for (const child of [section11, section12]) {
      expect(child.x).toBeGreaterThanOrEqual(chapter1.x);
      expect(child.y).toBeGreaterThanOrEqual(chapter1.y);
      expect(child.x + child.width).toBeLessThanOrEqual(chapter1.x + chapter1.width);
      expect(child.y + child.height).toBeLessThanOrEqual(chapter1.y + chapter1.height);
    }
    // Chapter 2 has no children of its own, so nothing from Chapter 1 leaks into it.
    expect(elementsWithinStep(chapter2, elements).map((el) => el.id)).toEqual([chapter2.id]);
    // And Chapter 2 must not overlap Chapter 1's box.
    expect(chapter2.x).toBeGreaterThanOrEqual(chapter1.x + chapter1.width);
  });

  it("nests three levels deep (H1 > H2 > H3)", () => {
    const { elements } = presentationFromWikiPage({
      title: "Doc",
      contentJson: doc([heading(1, "A"), heading(2, "B"), heading(3, "C")]),
    });
    const byLabel = new Map(
      elements.filter((el) => el.type === "frame").map((el) => [el.type === "frame" ? el.content.label : "", el]),
    );
    const a = byLabel.get("A")!;
    const b = byLabel.get("B")!;
    const c = byLabel.get("C")!;
    expect(c.x).toBeGreaterThanOrEqual(b.x);
    expect(c.x + c.width).toBeLessThanOrEqual(b.x + b.width);
    expect(b.x).toBeGreaterThanOrEqual(a.x);
    expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width);
  });

  it("embeds images under the heading they appear beneath, contained in its frame", () => {
    const { elements } = presentationFromWikiPage({
      title: "Doc",
      contentJson: doc([heading(1, "Chapter"), { type: "paragraph" }, image("att-1", "diagram")]),
    });
    const chapter = elements.find((el) => el.type === "frame")!;
    const img = elements.find((el) => el.type === "image");
    expect(img).toBeDefined();
    expect(img!.type === "image" && img!.content.attachmentId).toBe("att-1");
    expect(img!.x).toBeGreaterThanOrEqual(chapter.x);
    expect(img!.y).toBeGreaterThanOrEqual(chapter.y);
    expect(img!.x + img!.width).toBeLessThanOrEqual(chapter.x + chapter.width);
  });

  it("skips images with an empty attachmentId (unresolved markdown imports)", () => {
    const { elements } = presentationFromWikiPage({
      title: "Doc",
      contentJson: doc([heading(1, "Chapter"), image("", "no attachment yet")]),
    });
    expect(elements.some((el) => el.type === "image")).toBe(false);
  });

  it("omits images when includeImages is false", () => {
    const { elements } = presentationFromWikiPage(
      { title: "Doc", contentJson: doc([heading(1, "Chapter"), image("att-1")]) },
      { includeImages: false },
    );
    expect(elements.some((el) => el.type === "image")).toBe(false);
  });

  it("drops images that appear before any heading", () => {
    const { elements } = presentationFromWikiPage({
      title: "Doc",
      contentJson: doc([image("att-1"), heading(1, "Chapter")]),
    });
    expect(elements.some((el) => el.type === "image")).toBe(false);
  });

  it("produces output that validates against the presentation schemas", () => {
    const { elements, steps } = presentationFromWikiPage({
      title: "Doc",
      contentJson: doc([
        heading(1, "Chapter 1"),
        heading(2, "Section 1.1"),
        image("att-1", "diagram"),
        heading(1, "Chapter 2"),
      ]),
    });
    expect(() => presentationElementsSchema.parse(elements)).not.toThrow();
    expect(() => presentationStepsSchema.parse(steps)).not.toThrow();
    // Every step must point at an element that actually exists.
    const ids = new Set(elements.map((el) => el.id));
    for (const step of steps) expect(ids.has(step.elementId)).toBe(true);
  });

  it("ignores a heading with only whitespace as its text", () => {
    const { elements } = presentationFromWikiPage({
      title: "Doc",
      contentJson: doc([heading(1, "   "), heading(1, "Real")]),
    });
    const frames = elements.filter((el) => el.type === "frame");
    expect(frames).toHaveLength(1);
    expect(frames[0].type === "frame" && frames[0].content.label).toBe("Real");
  });
});
