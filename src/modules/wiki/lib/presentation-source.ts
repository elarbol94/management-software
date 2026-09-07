import type { PresentationElement } from "./presentation";
import type { DocumentSourceSnapshot } from "./document-source-snapshot";
import type { DocumentSection, DocumentHeadingStructure } from "./document-sections";

export type PresentationSource = { pageId: string; sectionId: string; reviewedFingerprint?: string; syncHeading?: boolean; syncSubsections?: boolean; knownSectionIds?: string[]; approvedStructure?: DocumentHeadingStructure };
export type PresentationSourceDocument = { id: string; title: string; slug: string; sections: DocumentSection[] };
export type DocumentPresentationLink = { presentationId: string; title: string; elementId: string; label: string; sectionId: string };

/** An explicit null opts out of inheritance; absent links inherit from parents. */
export function presentationSourceOwner(elements: PresentationElement[], id: string): PresentationElement | null {
  const seen = new Set<string>();
  let element = elements.find((item) => item.id === id);
  while (element && !seen.has(element.id)) {
    seen.add(element.id);
    if (element.source !== undefined) return element.source ? element : null;
    element = elements.find((item) => item.id === element?.parentId);
  }
  return null;
}

export function documentSectionHref(slug: string, sectionId: string, presentationId?: string, elementId?: string, resume?: string) {
  const query = new URLSearchParams({ section: sectionId });
  if (presentationId) query.set("presentation", presentationId);
  if (elementId) query.set("element", elementId);
  if (resume) query.set("resume", resume);
  return `/wiki/pages/${encodeURIComponent(slug)}?${query}`;
}

export function presentationElementHref(presentationId: string, elementId: string, resume?: string) {
  const query = new URLSearchParams({ element: elementId });
  if (resume) query.set("resume", resume);
  return `/wiki/presentations/${encodeURIComponent(presentationId)}?${query}`;
}

export function withoutPresentationSources<T extends { elements: PresentationElement[] }>(snapshot: T): T {
  return { ...snapshot, elements: snapshot.elements.map((element) => {
    const copy = { ...element };
    delete copy.source;
    return copy;
  }) };
}

export function presentationSource(elements: PresentationElement[], id: string): PresentationSource | null {
  return presentationSourceOwner(elements, id)?.source ?? null;
}

export type PresentationSourcePreview = {
  pageId: string; sectionId: string;
  document: Pick<PresentationSourceDocument, "id" | "title" | "slug"> | null;
  snapshot: DocumentSourceSnapshot | null;
};
export function sourceKey(source: Pick<PresentationSource, "pageId" | "sectionId">) {
  return JSON.stringify([source.pageId, source.sectionId]);
}
export function sourceReviewStatus(source: PresentationSource, preview: PresentationSourcePreview) {
  if (!preview.snapshot) return "missing";
  if (!source.reviewedFingerprint) return "unreviewed";
  return source.reviewedFingerprint === preview.snapshot.fingerprint ? "current" : "changed";
}

/** Only explicit frame links follow headings. Inherited links on child elements
 * carry provenance without turning every child label into the same heading. */
export function synchronizePresentationHeadings(elements: PresentationElement[], previews: ReadonlyMap<string, PresentationSourcePreview>): PresentationElement[] {
  let changed = false;
  const next = elements.map((element) => {
    if (element.type !== "frame" || !element.source?.sectionId || element.source.syncHeading === false) return element;
    const heading = previews.get(sourceKey(element.source))?.snapshot?.headingTitle;
    if (heading === undefined || heading === element.content.label) return element;
    changed = true;
    return { ...element, content: { ...element.content, label: heading } };
  });
  return changed ? next : elements;
}

export function preservePresentationHeadingOverride(before: PresentationElement, after: PresentationElement): PresentationElement {
  if (before.type === "frame" && after.type === "frame" && after.source?.sectionId && before.content.label !== after.content.label) {
    return { ...after, source: { ...after.source, syncHeading: false } };
  }
  return after;
}

/** Source observations outlive canvas undo: removing/undoing an automatic frame
 * must not make the next poll insert it again. Link changes remain ordinary undo. */
export function retainObservedPresentationSections(elements: PresentationElement[], observed: PresentationElement[]): PresentationElement[] {
  let changed = false;
  const next = elements.map((element) => {
    const current = observed.find((item) => item.id === element.id)?.source;
    if (!element.source || !current || sourceKey(element.source) !== sourceKey(current) || !current.knownSectionIds?.length) return element;
    const knownSectionIds = [...new Set([...(element.source.knownSectionIds ?? []), ...current.knownSectionIds])];
    if (knownSectionIds.length === element.source.knownSectionIds?.length) return element;
    changed = true;
    return { ...element, source: { ...element.source, knownSectionIds } };
  });
  return changed ? next : elements;
}
