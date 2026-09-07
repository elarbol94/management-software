import type { DocumentSubsection } from "./document-source-snapshot";
import { isPresentationElementLocked, presentationAncestors, presentationCameraBounds, presentationDescendants, presentationElementsSchema, unionBounds, type PresentationBounds, type PresentationElement, type PresentationFrameElement } from "./presentation";
import { presentationValuesEqual } from "./presentation-merge";
import { sourceKey, type PresentationSourcePreview } from "./presentation-source";

const GAP = 60;
export type SubsectionProposal = {
  parentId: string;
  addedIds: string[];
  sectionIds: string[];
  elements: PresentationElement[];
  requiresReview: boolean;
  issue?: "subsectionsLocked" | "subsectionsGeometry" | "subsectionsLimit" | "subsectionsAmbiguous" | "subsectionsStructure";
  movedIds: string[];
};

const overlaps = (a: PresentationBounds, b: PresentationBounds) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer: PresentationBounds, inner: PresentationBounds) => inner.x >= outer.x + GAP && inner.y >= outer.y + GAP && inner.x + inner.width <= outer.x + outer.width - GAP && inner.y + inner.height <= outer.y + outer.height - GAP;

// Stable across concurrent editors; these are canvas identities, not security tokens.
function subsectionId(parentId: string, pageId: string, sectionId: string) {
  const input = JSON.stringify([parentId, pageId, sectionId]);
  const hash = (seed: number) => {
    let value = seed;
    for (let i = 0; i < input.length; i++) value = Math.imul(value ^ input.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16).padStart(8, "0");
  };
  return `sub-${hash(2166136261)}${hash(3339675911)}`;
}

/** Enabling an existing link starts at today's outline, preserving deliberate omissions. */
export function subsectionBaseline(preview: PresentationSourcePreview | undefined): string[] {
  return preview?.snapshot?.subsections?.map((section) => section.id) ?? [];
}

/** One proposal per linked container. Reading sources never directly mutates the canvas. */
export function presentationSubsectionProposals(elements: PresentationElement[], previews: ReadonlyMap<string, PresentationSourcePreview>): SubsectionProposal[] {
  const frames = elements.filter((element): element is PresentationFrameElement => element.type === "frame" && Boolean(element.source));
  const represented = new Set(frames.map((frame) => sourceKey(frame.source!)));
  const known = new Set(frames.flatMap((frame) => (frame.source!.knownSectionIds ?? []).map((sectionId) => sourceKey({ pageId: frame.source!.pageId, sectionId }))));
  return frames.flatMap((parent) => {
    const source = parent.source!;
    if (!source.syncSubsections || !source.knownSectionIds) return [];
    const snapshot = previews.get(sourceKey(source))?.snapshot;
    if (!snapshot?.subsections) return [];
    const sections = snapshot.subsections;
    const fresh = sections.filter((section) => section.parentSectionId === (source.sectionId || null) && !represented.has(sourceKey({ pageId: source.pageId, sectionId: section.id })) && !known.has(sourceKey({ pageId: source.pageId, sectionId: section.id })));
    if (!fresh.length && !snapshot.subsectionsTruncated) return [];
    const proposal: SubsectionProposal = { parentId: parent.id, addedIds: [], sectionIds: [], elements, requiresReview: false, movedIds: [] };
    if (snapshot.subsectionsTruncated) return [{ ...proposal, issue: "subsectionsLimit" as const }];
    if (frames.filter((frame) => sourceKey(frame.source!) === sourceKey(source)).length > 1) return [{ ...proposal, issue: "subsectionsAmbiguous" as const }];
    // Resolve existing heading moves before extending the affected hierarchy.
    const ancestors = [parent, ...presentationAncestors(elements, parent.id)];
    if (ancestors.some((frame) => frame.source?.sectionId && !presentationValuesEqual(frame.source.approvedStructure, previews.get(sourceKey(frame.source))?.snapshot?.headingStructure))) return [{ ...proposal, issue: "subsectionsStructure" as const }];
    let next = [...elements];
    const added: PresentationFrameElement[] = [];
    const build = (section: DocumentSubsection, parentId: string, style: PresentationFrameElement): PresentationFrameElement => {
      const id = subsectionId(parentId, source.pageId, section.id);
      const children = sections.filter((child) => child.parentSectionId === section.id && !represented.has(sourceKey({ pageId: source.pageId, sectionId: child.id })) && !known.has(sourceKey({ pageId: source.pageId, sectionId: child.id })));
      const frame: PresentationFrameElement = { id, type: "frame", parentId, x: 0, y: 0, width: 360, height: 220, rotation: 0,
        ...(style.background !== undefined ? { background: style.background } : {}),
        content: { label: section.title.slice(0, 200), shape: style.content.shape, color: style.content.color },
        source: { pageId: source.pageId, sectionId: section.id, syncHeading: true, syncSubsections: true,
          approvedStructure: { level: section.level, parentSectionId: section.parentSectionId }, knownSectionIds: descendants(section.id).map((child) => child.id) } };
      added.push(frame);
      let x = GAP;
      for (const child of children) {
        const start = added.length;
        const nested = build(child, id, style);
        for (const item of added.slice(start)) { item.x += x; item.y += GAP; }
        x += nested.width + GAP;
        frame.height = Math.max(frame.height, nested.height + 2 * GAP);
      }
      if (children.length) frame.width = Math.max(frame.width, x);
      return frame;
    };
    const descendants = (id: string): DocumentSubsection[] => {
      const ids = new Set([id]);
      return sections.filter((section) => { if (section.parentSectionId && ids.has(section.parentSectionId)) { ids.add(section.id); return true; } return false; });
    };
    const subtreeBounds = (list: PresentationElement[], id: string) => {
      const ids = presentationDescendants(list, new Set([id]));
      return unionBounds(list.filter((element) => ids.has(element.id)).map(presentationCameraBounds))!;
    };
    const style = frames.find((frame) => frame.parentId === parent.id && frame.source?.pageId === source.pageId) ?? parent;
    for (const section of fresh) {
      const start = added.length;
      const frame = build(section, parent.id, style);
      const occupied = next.filter((element) => element.parentId === parent.id).map((element) => subtreeBounds(next, element.id));
      const candidates = [{ x: parent.x + GAP, y: parent.y + GAP }, ...occupied.flatMap((box) => [
        { x: box.x + box.width + GAP, y: parent.y + GAP }, { x: parent.x + GAP, y: box.y + box.height + GAP },
        { x: box.x + box.width + GAP, y: box.y }, { x: box.x, y: box.y + box.height + GAP },
      ])].map((position) => ({ ...position, width: frame.width, height: frame.height }));
      const room = candidates.filter((box) => contains(parent, box) && occupied.every((other) => !overlaps({ x: box.x - GAP, y: box.y - GAP, width: box.width + 2 * GAP, height: box.height + 2 * GAP }, other))).sort((a, b) => a.y - b.y || a.x - b.x)[0];
      const content = unionBounds(occupied);
      const position = room ?? { x: parent.x + GAP, y: Math.max(parent.y + GAP, content ? content.y + content.height + GAP : parent.y + GAP) };
      for (const item of added.slice(start)) { item.x += position.x; item.y += position.y; }
      next.push(...added.slice(start));
    }
    proposal.addedIds = added.map((frame) => frame.id);
    proposal.sectionIds = added.map((frame) => frame.source!.sectionId);
    if (next.length > 500 || new Set(next.map((element) => element.id)).size !== next.length) return [{ ...proposal, issue: "subsectionsLimit" as const }];
    for (const ancestor of ancestors) {
      const current = next.find((element) => element.id === ancestor.id)!;
      if (current.rotation !== 0) return [{ ...proposal, issue: "subsectionsGeometry" as const }];
      const children = next.filter((element) => element.parentId === current.id);
      const bounds = unionBounds(children.map((element) => subtreeBounds(next, element.id)));
      if (bounds) next = next.map((element) => element.id === current.id ? { ...element,
        width: Math.max(element.width, bounds.x + bounds.width + GAP - element.x),
        height: Math.max(element.height, bounds.y + bounds.height + GAP - element.y) } : element);
      const after = subtreeBounds(next, current.id);
      const before = subtreeBounds(elements, current.id);
      const siblings = next.filter((element) => element.parentId === current.parentId && element.id !== current.id);
      if (siblings.some((sibling) => overlaps(after, subtreeBounds(next, sibling.id)) && !overlaps(before, subtreeBounds(elements, sibling.id)))) {
        const occupied = unionBounds(siblings.map((element) => subtreeBounds(next, element.id)))!;
        const dx = occupied.x + occupied.width + GAP - after.x;
        const ids = presentationDescendants(next, new Set([current.id]));
        next = next.map((element) => ids.has(element.id) ? { ...element, x: element.x + dx } : element);
        proposal.requiresReview = true;
      }
    }
    // Remember accepted identities on every linked source ancestor. This survives
    // deleting an added frame, including later document reparenting of that section.
    next = next.map((element) => element.source?.pageId === source.pageId && (element.id === parent.id || (element.source.knownSectionIds ?? []).includes(source.sectionId))
      ? { ...element, source: { ...element.source, knownSectionIds: [...new Set([...(element.source.knownSectionIds ?? []), ...proposal.sectionIds])] } } : element);
    if (next.some((element) => (element.source?.knownSectionIds?.length ?? 0) > 5000)) return [{ ...proposal, issue: "subsectionsLimit" as const }];
    if (!presentationElementsSchema.safeParse(next).success) return [{ ...proposal, issue: "subsectionsGeometry" as const }];
    const affected = elements.filter((element) => !presentationValuesEqual(element, next.find((item) => item.id === element.id)));
    if (isPresentationElementLocked(elements, parent.id) || affected.some((element) => isPresentationElementLocked(elements, element.id))) return [{ ...proposal, issue: "subsectionsLocked" as const }];
    proposal.movedIds = affected.filter((element) => { const after = next.find((item) => item.id === element.id)!; return element.x !== after.x || element.y !== after.y; }).map((element) => element.id);
    return [{ ...proposal, elements: next }];
  });
}
