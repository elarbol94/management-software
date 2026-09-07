import { describe, expect, it } from "vitest";
import { documentSectionHref, presentationElementHref, presentationSource, withoutPresentationSources } from "./presentation-source";
import { presentationFromWikiPage } from "./presentation-from-wiki";
import { initialPresentationCanvasState, presentationCanvasReducer, presentationElementsSchema, type PresentationElement } from "./presentation";
import { mergePresentation } from "./presentation-merge";

const parent: PresentationElement = { id: "parent", type: "frame", x: 0, y: 0, width: 900, height: 500, rotation: 0, content: { label: "Frame", shape: "rect", color: "" }, source: { pageId: "page", sectionId: "section" } };
const child: PresentationElement = { ...parent, id: "child", parentId: "parent", source: undefined };

describe("presentation document sources", () => {
  it("inherits through frames, supports overrides and unlinking, and stops on cycles", () => {
    expect(presentationSource([parent, child], "child")).toEqual(parent.source);
    expect(presentationSource([parent, { ...child, source: null }], "child")).toBeNull();
    expect(presentationSource([parent, { ...child, source: { pageId: "other", sectionId: "specific" } }], "child")?.pageId).toBe("other");
    expect(presentationSource([{ ...parent, source: undefined, parentId: "child" }, child], "child")).toBeNull();
  });
  it("retains sources through schema parsing, undo and redo", () => {
    const parsed = presentationElementsSchema.parse([parent, child]);
    let state = initialPresentationCanvasState(parsed, []);
    state = presentationCanvasReducer(state, { type: "edit", at: 1000, elements: (elements) => elements.map((element) => ({ ...element, source: null })) });
    expect(state.elements[0].source).toBeNull();
    state = presentationCanvasReducer(state, { type: "undo" });
    expect(state.elements[0].source).toEqual(parent.source);
    state = presentationCanvasReducer(state, { type: "redo" });
    expect(state.elements[0].source).toBeNull();
  });
  it("automatically connects generated frames and their images to stable document sections", () => {
    const generated = presentationFromWikiPage({ id: "page", title: "Doc", contentJson: JSON.stringify({ type: "doc", content: [
      { type: "heading", attrs: { level: 1, id: "budget" }, content: [{ type: "text", text: "Financial plan" }] },
      { type: "commentableImage", attrs: { attachmentId: "image" } },
    ] }) });
    expect(generated.elements[0].source).toEqual({ pageId: "page", sectionId: "budget" });
    expect(presentationSource(generated.elements, generated.elements[1].id)).toEqual(generated.elements[0].source);
    const empty = presentationFromWikiPage({ id: "page", title: "Doc", contentJson: "" });
    expect(empty.elements[0].source).toEqual({ pageId: "page", sectionId: "" });
  });
  it("strips all document references from public and reusable copies", () => {
    const snapshot = { elements: [parent, child] };
    expect(JSON.stringify(withoutPresentationSources(snapshot))).not.toContain('"source"');
    expect(snapshot.elements[0].source).toBeTruthy();
  });
  it("encodes section and element targets without accepting a destination URL", () => {
    expect(documentSectionHref("a/b", "x&y", "deck", "element")).toBe("/wiki/pages/a%2Fb?section=x%26y&presentation=deck&element=element");
    expect(presentationElementHref("a/b", "x&y")).toBe("/wiki/presentations/a%2Fb?element=x%26y");
  });
  it("treats competing source changes as one conflict instead of mixing page and section IDs", () => {
    const base = initialPresentationCanvasState([parent], []);
    const local = { ...base, elements: [{ ...parent, source: { pageId: "other", sectionId: "section" } }] };
    const remote = { ...base, elements: [{ ...parent, source: { pageId: "page", sectionId: "other-section" } }] };
    expect(mergePresentation(base, local, remote).conflicts).toContain("elements.parent.source");
  });
});
