import type { DocumentHeadingStructure } from "./document-sections";
import { isPresentationElementLocked, presentationAncestors, presentationCameraBounds, presentationDescendants, presentationElementsSchema, unionBounds, type PresentationElement } from "./presentation";
import { presentationValuesEqual } from "./presentation-merge";
import { sourceKey, type PresentationSourcePreview } from "./presentation-source";

export type StructureChange = {
  elementId: string;
  before?: DocumentHeadingStructure;
  after: DocumentHeadingStructure;
  oldParentId?: string;
  newParentId?: string;
};
export type StructureIssue = { kind: "missingParent" | "ambiguousParent" | "lockedStructure" | "invalidStructureGeometry"; elementId: string };
export type StructureProposal = {
  id: string;
  changes: StructureChange[];
  affectedIds: string[];
  issues: StructureIssue[];
  elements: PresentationElement[];
};

/** Captures all inputs that can change an approval, excluding unrelated body edits. */
export function structureReviewKey(elements: PresentationElement[], previews: ReadonlyMap<string, PresentationSourcePreview>): string {
  return JSON.stringify([elements, elements.filter((e) => e.type === "frame" && e.source?.sectionId).map((e) => [sourceKey(e.source!), previews.get(sourceKey(e.source!))?.snapshot?.headingStructure ?? null])]);
}

/** Pure proposals: observing document changes must never mutate the canvas. */
export function presentationStructureProposals(elements: PresentationElement[], previews: ReadonlyMap<string, PresentationSourcePreview>): StructureProposal[] {
  const frames = elements.filter((e) => e.type === "frame" && e.source?.sectionId);
  const candidates = frames.flatMap((element) => {
    const source = element.source!;
    const after = previews.get(sourceKey(source))?.snapshot?.headingStructure;
    if (!after || presentationValuesEqual(source.approvedStructure, after)) return [];
    const parents = after.parentSectionId === null ? [] : frames.filter((other) => other.source!.pageId === source.pageId && other.source!.sectionId === after.parentSectionId);
    const issues: StructureIssue[] = after.parentSectionId !== null && parents.length !== 1
      ? [{ kind: parents.length ? "ambiguousParent" : "missingParent", elementId: element.id }] : [];
    const change: StructureChange = { elementId: element.id, before: source.approvedStructure, after, oldParentId: element.parentId, newParentId: parents[0]?.id };
    // Level-only changes are independent. Reparenting can also move descendants
    // and refit old/new ancestors, so their pending changes belong in one review.
    const dependencies = new Set([element.id]);
    if (element.parentId !== parents[0]?.id) {
      for (const descendant of presentationDescendants(elements, new Set([element.id]))) dependencies.add(descendant);
      for (const ancestor of presentationAncestors(elements, element.id)) dependencies.add(ancestor.id);
      if (parents[0]) {
        dependencies.add(parents[0].id);
        for (const ancestor of presentationAncestors(elements, parents[0].id)) dependencies.add(ancestor.id);
      }
    }
    return [{ change, issues, dependencies, pageId: source.pageId }];
  });
  const groups: typeof candidates[] = [];
  for (const candidate of candidates) {
    let group = [candidate];
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].some((a) => group.some((b) => a.pageId === b.pageId && [...a.dependencies].some((id) => b.dependencies.has(id))))) {
        group = [...groups.splice(i, 1)[0], ...group];
      }
    }
    groups.push(group);
  }
  return groups.map((group) => {
    const changes = group.map((item) => item.change);
    const issues = group.flatMap((item) => item.issues);
    const result = issues.length ? { elements, issues, affectedIds: changes.map((c) => c.elementId) } : layoutStructureChange(elements, changes);
    return { id: changes.map((c) => c.elementId).sort().join(":"), changes, ...result };
  });
}

const GAP = 60;
function layoutStructureChange(original: PresentationElement[], changes: StructureChange[]): Pick<StructureProposal, "elements" | "issues" | "affectedIds"> {
  let elements = original.map((element) => {
    const change = changes.find((item) => item.elementId === element.id);
    return change ? { ...element, parentId: change.newParentId, source: { ...element.source!, approvedStructure: change.after } } : element;
  });
  const moved = new Set(changes.filter((c) => c.oldParentId !== c.newParentId).map((c) => c.elementId));
  const containers = new Set<string>();
  for (const id of moved) {
    for (const list of [original, elements]) for (const parent of presentationAncestors(list, id)) containers.add(parent.id);
  }
  const invalid = (elementId: string): Pick<StructureProposal, "elements" | "issues" | "affectedIds"> => ({ elements: original, affectedIds: [...new Set([...moved, ...containers, ...changes.map((c) => c.elementId)])], issues: [{ kind: "invalidStructureGeometry", elementId }] });
  if (!presentationElementsSchema.safeParse(elements).success) return invalid(changes[0].elementId);
  // Refitting a rotated container would change its children's local geometry.
  const rotated = elements.find((e) => containers.has(e.id) && e.rotation !== 0);
  if (rotated) return invalid(rotated.id);
  const subtree = (id: string) => presentationDescendants(elements, new Set([id]));
  const bounds = (ids: Set<string>) => unionBounds(elements.filter((e) => ids.has(e.id)).map(presentationCameraBounds))!;
  const translate = (id: string, x: number, y: number) => {
    const ids = subtree(id), box = bounds(ids);
    elements = elements.map((e) => ids.has(e.id) ? { ...e, x: e.x + x - box.x, y: e.y + y - box.y } : e);
  };
  const overlaps = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const originalBoxes = new Map<string, ReturnType<typeof bounds>>();
  const originalBounds = (id: string) => {
    if (!originalBoxes.has(id)) {
      const ids = presentationDescendants(original, new Set([id]));
      originalBoxes.set(id, unionBounds(original.filter((e) => ids.has(e.id)).map(presentationCameraBounds))!);
    }
    return originalBoxes.get(id)!;
  };
  const arrange = (parentId?: string) => {
    const children = elements.filter((e) => e.parentId === parentId);
    for (const child of children) arrange(child.id);
    const parent = elements.find((e) => e.id === parentId);
    const fixed = children.filter((e) => !moved.has(e.id));
    const occupied = unionBounds(fixed.map((e) => bounds(subtree(e.id))));
    let x = occupied ? occupied.x + occupied.width + GAP : parent ? parent.x + GAP : 0;
    const y = occupied?.y ?? (parent ? parent.y + GAP : 0);
    for (const child of children.filter((e) => moved.has(e.id))) {
      translate(child.id, x, y);
      x += bounds(subtree(child.id)).width + GAP;
    }
    // An expanded container can run into its untouched neighbour. Relocate only
    // that container and its contents into free space, keeping the neighbour fixed.
    for (const child of children.filter((e) => containers.has(e.id) || moved.has(e.id))) {
      const box = bounds(subtree(child.id));
      const others = children.filter((e) => e.id !== child.id);
      if (others.some((other) => overlaps(box, bounds(subtree(other.id))) && !overlaps(originalBounds(child.id), originalBounds(other.id)))) {
        const occupied = unionBounds(others.map((e) => bounds(subtree(e.id))));
        if (occupied) translate(child.id, occupied.x + occupied.width + GAP, box.y);
      }
    }
    if (parent && containers.has(parent.id)) {
      const content = unionBounds(children.map((e) => bounds(subtree(e.id))));
      const box = content ? { x: content.x - GAP, y: content.y - GAP, width: Math.max(360, content.width + 2 * GAP), height: Math.max(220, content.height + 2 * GAP) } : { x: parent.x, y: parent.y, width: 360, height: 220 };
      elements = elements.map((e) => e.id === parent.id ? { ...e, ...box } : e);
    }
  };
  if (moved.size) arrange();
  if (!presentationElementsSchema.safeParse(elements).success) return invalid(changes[0].elementId);
  const affectedIds = elements.filter((e, i) => !presentationValuesEqual(e, original[i])).map((e) => e.id);
  const locked = affectedIds.find((id) => isPresentationElementLocked(original, id) || isPresentationElementLocked(elements, id));
  if (locked) return { elements: original, affectedIds, issues: [{ kind: "lockedStructure", elementId: locked }] };
  return { elements, affectedIds, issues: [] };
}

/** Guard again inside the reducer so queued edits cannot be overwritten. */
export function applyStructureProposal(current: PresentationElement[], expected: PresentationElement[], proposal: StructureProposal): PresentationElement[] {
  return !proposal.issues.length && presentationValuesEqual(current, expected) ? proposal.elements : current;
}
