import "server-only";

import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { wikiPages, wikiPresentations } from "@/db/schema";
import { documentSections } from "./lib/document-sections";
import { parseStoredDocument } from "./lib/tiptap";
import { parsePresentationCanvas, stepLabel } from "./lib/presentation";
import type { DocumentPresentationLink, PresentationSourceDocument } from "./lib/presentation-source";
import { presentationRole } from "./presentation-access";

/** Wiki pages currently share workspace access. Call only after requireUser. */
export function listPresentationSourceDocuments(): PresentationSourceDocument[] {
  return db.select({ id: wikiPages.id, title: wikiPages.title, slug: wikiPages.slug, contentJson: wikiPages.contentJson })
    .from(wikiPages).where(isNull(wikiPages.deletedAt)).orderBy(asc(wikiPages.title)).all()
    .map(({ contentJson, ...page }) => ({ ...page, sections: documentSections(parseStoredDocument(contentJson)) }));
}

export function getPresentationSourceDocument(pageId: string): PresentationSourceDocument | null {
  const page = db.select({ id: wikiPages.id, title: wikiPages.title, slug: wikiPages.slug, contentJson: wikiPages.contentJson, deletedAt: wikiPages.deletedAt })
    .from(wikiPages).where(eq(wikiPages.id, pageId)).get();
  if (!page || page.deletedAt) return null;
  return { id: page.id, title: page.title, slug: page.slug, sections: documentSections(parseStoredDocument(page.contentJson)) };
}

export function documentPresentationLinks(pageId: string, viewer: { id: string; role?: string | null }): DocumentPresentationLink[] {
  // Links live in the revisioned canvas: undo, restore and deletion immediately
  // update backlinks, with no second index that can drift out of sync.
  return db.select({ id: wikiPresentations.id, title: wikiPresentations.title, elementsJson: wikiPresentations.elementsJson })
    .from(wikiPresentations).orderBy(asc(wikiPresentations.title)).all()
    .filter((row) => presentationRole(row.id, viewer))
    .flatMap((row) => parsePresentationCanvas(row.elementsJson).elements.flatMap((element, index) =>
      element.source?.pageId === pageId ? [{ presentationId: row.id, title: row.title, elementId: element.id, label: stepLabel(element, index), sectionId: element.source.sectionId }] : []));
}
