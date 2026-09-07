import { describe, expect, it } from "vitest";
import { documentSourceSnapshots } from "./document-source-snapshot";
import { presentationFromWikiPage } from "./presentation-from-wiki";
import { applyStructureProposal, presentationStructureProposals, structureReviewKey } from "./presentation-structure";
import { sourceKey, withoutPresentationSources } from "./presentation-source";
import { initialPresentationCanvasState, presentationCameraBounds, presentationCanvasReducer, presentationElementsSchema, type PresentationElement } from "./presentation";
import type { TiptapNode } from "./tiptap";

function document(levels = [1, 2, 2, 1]): TiptapNode {
  return { type: "doc", content: levels.map((level, i) => ({ type: "heading", attrs: { id: `s${i}`, level }, content: [{ type: "text", text: `Section ${i}` }] })) };
}
function deck(levels?: number[]) {
  return presentationFromWikiPage({ id: "page", title: "Doc", contentJson: JSON.stringify(document(levels)) });
}
function previews(doc: TiptapNode) {
  const snapshot = documentSourceSnapshots(doc);
  return new Map(doc.content!.map((h) => {
    const ref = { pageId: "page", sectionId: String(h.attrs!.id) };
    return [sourceKey(ref), { ...ref, document: { id: "page", title: "Doc", slug: "doc" }, snapshot: snapshot(ref.sectionId) }];
  }));
}
const frame = (elements: PresentationElement[], section: number) => elements.find((e) => e.source?.sectionId === `s${section}`)!;

describe("approved heading structure", () => {
  it("initializes generation baselines and detects no changes for content reviews or folding", () => {
    const { elements } = deck();
    expect(frame(elements, 1).source?.approvedStructure).toEqual({ level: 2, parentSectionId: "s0" });
    const doc = document(); doc.content![1].attrs!.collapsed = true;
    doc.content![1].content![0].text = "Renamed";
    expect(presentationStructureProposals(elements, previews(doc))).toEqual([]);
    expect(withoutPresentationSources({ elements }).elements.every((e) => !e.source)).toBe(true);
    expect(presentationElementsSchema.parse(elements)).toEqual(elements);
  });
  it("promotes a section together with the following sibling, preserving contents and unrelated roots", () => {
    const { elements, steps } = deck();
    const child = frame(elements, 1);
    const custom: PresentationElement = { id: "custom", type: "text", parentId: child.id, x: child.x + 80, y: child.y + 90, width: 70, height: 25, rotation: 20, content: { text: "Keep me", fontSize: 20, bold: true, color: "", align: "left" } };
    elements.push(custom);
    const original = structuredClone(elements);
    const proposals = presentationStructureProposals(elements, previews(document([1, 1, 2, 1])));
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal.issues).toEqual([]);
    expect(proposal.changes.map((c) => c.elementId)).toEqual([child.id, frame(elements, 2).id]);
    expect(elements).toEqual(original);
    const next = applyStructureProposal(elements, elements, proposal);
    expect(frame(next, 1).parentId).toBeUndefined();
    expect(frame(next, 2).parentId).toBe(child.id);
    expect(frame(next, 3)).toEqual(frame(elements, 3));
    const movedCustom = next.find((e) => e.id === custom.id)!;
    expect(movedCustom.content).toEqual(custom.content);
    expect(movedCustom.width).toBe(custom.width);
    expect(movedCustom.rotation).toBe(custom.rotation);
    // Contents retain their relative spacing even when the container is refitted.
    const visible = presentationCameraBounds(movedCustom);
    expect(frame(next, 2).x - (visible.x + visible.width)).toBeCloseTo(60);
    expect(proposal.affectedIds).toContain(custom.id);
    expect(steps.map((s) => s.elementId)).toEqual(original.filter((e) => e.type === "frame").map((e) => e.id));
    expect(presentationStructureProposals(next, previews(document([1, 1, 2, 1])))).toEqual([]);
  });
  it("demotes a root and moves expanded containers clear of unrelated roots", () => {
    const { elements } = deck([1, 1, 1]);
    const p = presentationStructureProposals(elements, previews(document([1, 3, 1])))[0];
    expect(p.issues).toEqual([]);
    const a = frame(p.elements, 0), b = frame(p.elements, 1), c = frame(p.elements, 2);
    expect(b.parentId).toBe(a.id);
    expect(c).toEqual(frame(elements, 2));
    expect(a.x >= c.x + c.width || a.x + a.width <= c.x).toBe(true);
    expect(b.x).toBeGreaterThanOrEqual(a.x + 60);
    expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width - 60);
  });
  it("reviews a changed level even when the parent remains the same", () => {
    const { elements } = deck([1, 3]);
    const p = presentationStructureProposals(elements, previews(document([1, 2])))[0];
    expect(p.changes[0].before?.level).toBe(3);
    expect(p.changes[0].after.level).toBe(2);
    expect(p.elements.map(({ x, y, width, height, parentId }) => ({ x, y, width, height, parentId }))).toEqual(elements.map(({ x, y, width, height, parentId }) => ({ x, y, width, height, parentId })));
  });
  it("reviews level-only siblings separately but groups changes inside a moving ancestor", () => {
    const independent = deck([1, 3, 3]);
    expect(presentationStructureProposals(independent.elements, previews(document([1, 2, 2])))).toHaveLength(2);
    const moving = deck([1, 2, 4]);
    const proposals = presentationStructureProposals(moving.elements, previews(document([1, 1, 3])));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].changes).toHaveLength(2);
  });
  it("offers initial reviews for legacy links without silently accepting an existing mismatch", () => {
    const { elements } = deck();
    elements.forEach((e) => { delete e.source!.approvedStructure; });
    const p = presentationStructureProposals(elements, previews(document([1, 1, 2, 1])));
    expect(p.flatMap((p) => p.changes)).toHaveLength(4);
    expect(p.every((p) => p.changes.every((c) => c.before === undefined))).toBe(true);
    expect(frame(elements, 1).parentId).toBe(frame(elements, 0).id);
    expect(presentationElementsSchema.safeParse(elements).success).toBe(true);
  });
  it("blocks missing/ambiguous parents and affected locked descendants", () => {
    const { elements } = deck([1, 1]);
    const doc = previews(document([1, 2]));
    const missing = elements.filter((e) => e !== frame(elements, 0));
    expect(presentationStructureProposals(missing, doc)[0].issues[0].kind).toBe("missingParent");
    const duplicate = [...elements, { ...elements[0], id: "duplicate" }];
    expect(presentationStructureProposals(duplicate, doc)[0].issues[0].kind).toBe("ambiguousParent");
    const locked = elements.map((e) => ({ ...e, locked: true }));
    expect(presentationStructureProposals(locked, doc)[0].issues[0].kind).toBe("lockedStructure");
    const withChild = [...elements, { ...elements[1], id: "locked-child", parentId: elements[1].id, source: null, locked: true }];
    expect(presentationStructureProposals(withChild, doc)[0].issues[0].kind).toBe("lockedStructure");
  });
  it("blocks cycles, rotated containers and out-of-range dimensions", () => {
    const { elements } = deck([1, 1]);
    const doc = previews(document([1, 2]));
    const rotated = elements.map((e, i) => ({ ...e, rotation: i === 0 ? 15 : 0 }));
    expect(presentationStructureProposals(rotated, doc)[0].issues[0].kind).toBe("invalidStructureGeometry");
    const huge = elements.map((e) => ({ ...e, width: 20_000 }));
    expect(presentationStructureProposals(huge, doc)[0].issues[0].kind).toBe("invalidStructureGeometry");
    const cycle = elements.map((e, i) => i === 0 ? { ...e, parentId: elements[1].id } : e);
    expect(presentationStructureProposals(cycle, doc)[0].issues[0].kind).toBe("invalidStructureGeometry");
  });
  it("keeps independent root changes separate and rejects stale canvas approvals", () => {
    const { elements } = deck([1, 3, 1, 3]);
    const old = previews(document([1, 2, 1, 2]));
    const proposals = presentationStructureProposals(elements, old);
    expect(proposals).toHaveLength(2);
    const edited = elements.map((e) => ({ ...e, x: e.x + 1 }));
    expect(applyStructureProposal(edited, elements, proposals[0])).toBe(edited);
    expect(structureReviewKey(elements, old)).not.toBe(structureReviewKey(elements, previews(document([1, 1, 1, 2]))));
    expect(structureReviewKey(elements, old)).not.toBe(structureReviewKey(edited, old));
  });
  it("applies and undoes one atomic edit, preserving playback steps and source content review", () => {
    const { elements, steps } = deck();
    const p = presentationStructureProposals(elements, previews(document([1, 1, 2, 1])))[0];
    let state = initialPresentationCanvasState(elements, steps);
    state = presentationCanvasReducer(state, { type: "edit", at: 999, steps: () => [...steps] });
    state = presentationCanvasReducer(state, { type: "edit", at: 1000, separate: true, elements: (current) => applyStructureProposal(current, elements, p) });
    expect(state.past).toHaveLength(2);
    expect(state.steps).toEqual(steps);
    expect(frame(state.elements, 1).source?.reviewedFingerprint).toBe(frame(elements, 1).source?.reviewedFingerprint);
    const applied = state.elements;
    state = presentationCanvasReducer(state, { type: "undo" });
    expect(state.elements).toBe(elements);
    state = presentationCanvasReducer(state, { type: "redo" });
    expect(state.elements).toBe(applied);
    state = presentationCanvasReducer(state, { type: "edit", at: 1001, elements: (current) => current.map((e) => ({ ...e, x: e.x + 1 })) });
    expect(state.past).toHaveLength(3);
  });
});
