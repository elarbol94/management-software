import { describe, expect, it } from "vitest";
import { documentSourceSnapshots } from "./document-source-snapshot";
import { presentationFromWikiPage } from "./presentation-from-wiki";
import { presentationSubsectionProposals, subsectionBaseline } from "./presentation-subsections";
import { sourceKey, withoutPresentationSources } from "./presentation-source";
import { initialPresentationCanvasState, presentationCanvasReducer, presentationElementsSchema, presentationDescendants, type PresentationElement } from "./presentation";
import { mergePresentation } from "./presentation-merge";
import type { TiptapNode } from "./tiptap";

const doc = (headings: [string, number][]): TiptapNode => ({ type: "doc", content: headings.map(([id, level]) => ({ type: "heading", attrs: { id, level }, content: [{ type: "text", text: id }] })) });
const original = doc([["Planning", 1], ["Schedule", 2], ["Delivery", 1]]);
const updated = doc([["Planning", 1], ["Schedule", 2], ["Budget", 2], ["Delivery", 1]]);
const deck = (document = original) => presentationFromWikiPage({ id: "page", title: "Project", contentJson: JSON.stringify(document) });
const frame = (elements: PresentationElement[], id: string) => elements.find((element) => element.source?.sectionId === id)!;
function previews(document: TiptapNode) {
  const snapshot = documentSourceSnapshots(document);
  return new Map(["", ...document.content!.map((heading) => String(heading.attrs!.id))].map((sectionId) => {
    const source = { pageId: "page", sectionId };
    return [sourceKey(source), { ...source, document: { id: "page", title: "Project", slug: "project" }, snapshot: snapshot(sectionId) }];
  }));
}
function apply(elements: PresentationElement[], document = updated) {
  const proposal = presentationSubsectionProposals(elements, previews(document))[0];
  expect(proposal.issue).toBeUndefined();
  return proposal;
}

describe("automatic document subsections", () => {
  it("starts generated decks at the current outline and leaves older decks opt-in", () => {
    const { elements } = deck();
    expect(frame(elements, "Planning").source).toMatchObject({ syncSubsections: true, knownSectionIds: ["Schedule"] });
    expect(presentationSubsectionProposals(elements, previews(original))).toEqual([]);
    const legacy = elements.map((element) => { const source = { ...element.source! }; delete source.syncSubsections; delete source.knownSectionIds; return { ...element, source }; });
    expect(presentationSubsectionProposals(legacy, previews(updated))).toEqual([]);
    expect(subsectionBaseline(previews(updated).get(sourceKey(elements[0].source!)))).toEqual(["Schedule", "Budget"]);
  });
  it("adds inside a moved section without changing existing positions, style, content or playback", () => {
    const { elements, steps } = deck();
    const ids = presentationDescendants(elements, new Set([elements[0].id]));
    const moved = elements.map((element) => ids.has(element.id) ? { ...element, x: element.x + 1800, y: element.y + 800 } : element);
    const sibling = frame(moved, "Schedule");
    if (sibling.type === "frame") { sibling.content.color = "#6366f1"; sibling.content.shape = "circle"; }
    const original = structuredClone(moved);
    const p = apply(moved);
    expect(p.requiresReview).toBe(false);
    const parent = frame(p.elements, "Planning"), child = frame(p.elements, "Budget");
    expect(child.parentId).toBe(parent.id);
    expect(child.x).toBeGreaterThanOrEqual(parent.x + 60);
    expect(child.y + child.height).toBeLessThanOrEqual(parent.y + parent.height - 60);
    expect(child.content).toMatchObject({ label: "Budget", color: "#6366f1", shape: "circle" });
    for (const previous of original) {
      const after = p.elements.find((element) => element.id === previous.id)!;
      expect({ x: after.x, y: after.y, content: after.content }).toEqual({ x: previous.x, y: previous.y, content: previous.content });
    }
    const state = presentationCanvasReducer(initialPresentationCanvasState(moved, steps), { type: "edit", at: 1000, separate: true, elements: () => p.elements });
    expect(state.steps).toBe(steps);
    expect(moved).toEqual(original);
    expect(presentationElementsSchema.parse(p.elements)).toEqual(p.elements);
    expect(presentationSubsectionProposals(p.elements, previews(updated))).toEqual([]);
  });
  it("uses free space before expanding a frame", () => {
    const { elements } = deck(); elements[0] = { ...elements[0], width: 1500, height: 1000 };
    const p = apply(elements);
    expect(p.elements[0].width).toBe(1500); expect(p.elements[0].height).toBe(1000);
    expect(p.movedIds).toEqual([]);
  });
  it("builds a complete new nested subtree and follows future grandchildren", () => {
    const deeper = doc([["Planning", 1], ["Schedule", 2], ["Budget", 2], ["Costs", 3], ["Delivery", 1]]);
    const p = apply(deck().elements, deeper);
    expect(p.addedIds).toHaveLength(2);
    expect(frame(p.elements, "Costs").parentId).toBe(frame(p.elements, "Budget").id);
    expect(frame(p.elements, "Budget").source?.knownSectionIds).toEqual(["Costs"]);
    const next = apply(p.elements, doc([["Planning", 1], ["Schedule", 2], ["Budget", 2], ["Costs", 3], ["Income", 3], ["Delivery", 1]]));
    expect(next.addedIds).toHaveLength(1);
    expect(frame(next.elements, "Income").parentId).toBe(frame(next.elements, "Budget").id);
  });
  it("offers collision adjustments for review, moving only the affected section", () => {
    const { elements } = deck();
    const other = frame(elements, "Delivery");
    other.x = elements[0].x; other.y = elements[0].y + elements[0].height + 30;
    const p = apply(elements);
    expect(p.requiresReview).toBe(true);
    expect(frame(p.elements, "Delivery")).toEqual(other);
    expect(p.movedIds).toContain(elements[0].id);
    const parent = p.elements[0];
    expect(parent.x).toBeGreaterThanOrEqual(other.x + other.width + 60);
  });
  it("retains suppression across undo, redo, deletion, and saved reloads", () => {
    const { elements, steps } = deck();
    const p = apply(elements);
    let state = presentationCanvasReducer(initialPresentationCanvasState(elements, steps), { type: "edit", at: 1000, separate: true, elements: () => p.elements });
    state = presentationCanvasReducer(state, { type: "undo" });
    expect(state.elements).toHaveLength(elements.length);
    expect(frame(state.elements, "Planning").source?.knownSectionIds).toContain("Budget");
    expect(presentationSubsectionProposals(state.elements, previews(updated))).toEqual([]);
    expect(presentationSubsectionProposals(presentationElementsSchema.parse(JSON.parse(JSON.stringify(state.elements))), previews(updated))).toEqual([]);
    state = presentationCanvasReducer(state, { type: "redo" });
    expect(frame(state.elements, "Budget")).toBeTruthy();
    state = presentationCanvasReducer(state, { type: "edit", at: 2000, elements: (current) => current.filter((element) => !p.addedIds.includes(element.id)) });
    expect(presentationSubsectionProposals(state.elements, previews(updated))).toEqual([]);
  });
  it("never regenerates an existing moved frame, or a deliberately omitted subsection", () => {
    const { elements } = deck();
    const omitted = elements.filter((element) => element.source?.sectionId !== "Schedule");
    expect(presentationSubsectionProposals(omitted, previews(original))).toEqual([]);
    const reparent = doc([["Planning", 1], ["Delivery", 1], ["Schedule", 2]]);
    expect(presentationSubsectionProposals(elements, previews(reparent))).toEqual([]);
  });
  it("waits for locks, rotations, ambiguous links and structure reviews", () => {
    const { elements } = deck();
    const issue = (list: PresentationElement[]) => presentationSubsectionProposals(list, previews(updated))[0].issue;
    expect(issue(elements.map((element, i) => i === 0 ? { ...element, locked: true } : element))).toBe("subsectionsLocked");
    expect(issue(elements.map((element, i) => i === 0 ? { ...element, rotation: 15 } : element))).toBe("subsectionsGeometry");
    expect(issue([...elements, { ...elements[0], id: "duplicate" }])).toBe("subsectionsAmbiguous");
    expect(issue(elements.map((element, i) => i === 0 ? { ...element, source: { ...element.source!, approvedStructure: { level: 2, parentSectionId: null } } } : element))).toBe("subsectionsStructure");
  });
  it("bounds outline and object growth without losing a pending addition", () => {
    const { elements } = deck();
    const many = [...elements, ...Array.from({ length: 497 }, (_, index) => ({ ...elements[2], id: `extra-${index}`, source: null }))];
    expect(presentationSubsectionProposals(many, previews(updated))[0].issue).toBe("subsectionsLimit");
    const tooMany = previews(updated); tooMany.get(sourceKey(elements[0].source!))!.snapshot!.subsectionsTruncated = true;
    expect(presentationSubsectionProposals(elements, tooMany)[0].issue).toBe("subsectionsLimit");
    expect(frame(elements, "Planning").source?.knownSectionIds).not.toContain("Budget");
  });
  it("handles documents that acquire their first headings", () => {
    const { elements } = deck(doc([]));
    const p = apply(elements, doc([["First", 1], ["Nested", 2]]));
    expect(frame(p.elements, "First").parentId).toBe(elements[0].id);
    expect(frame(p.elements, "Nested").parentId).toBe(frame(p.elements, "First").id);
  });
  it("uses identical identities for concurrent additions and strips tracking from public copies", () => {
    const { elements, steps } = deck();
    const first = apply(elements), second = apply(structuredClone(elements));
    const base = initialPresentationCanvasState(elements, steps);
    const merged = mergePresentation(base, { ...base, elements: first.elements }, { ...base, elements: second.elements });
    expect(merged.conflicts).toEqual([]);
    expect(merged.snapshot.elements).toHaveLength(first.elements.length);
    expect(withoutPresentationSources(merged.snapshot).elements.every((element) => element.source === undefined)).toBe(true);
  });
});
