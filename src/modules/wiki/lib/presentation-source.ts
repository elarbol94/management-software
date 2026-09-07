import type { PresentationElement } from "./presentation";
import type { DocumentSourceSnapshot } from "./document-source-snapshot";
import type { DocumentSection } from "./document-sections";

export type PresentationSource = { pageId: string; sectionId: string; reviewedFingerprint?: string };
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
