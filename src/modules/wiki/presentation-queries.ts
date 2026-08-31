import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user, wikiPresentations } from "@/db/schema";
import {
  normalizeSteps,
  parsePresentationCanvas,
  parsePresentationSteps,
} from "./lib/presentation";

export function listPresentations() {
  return db
    .select({
      id: wikiPresentations.id,
      title: wikiPresentations.title,
      elementsJson: wikiPresentations.elementsJson,
      pathJson: wikiPresentations.pathJson,
      updatedAt: wikiPresentations.updatedAt,
      updatedByName: user.name,
    })
    .from(wikiPresentations)
    .leftJoin(user, eq(wikiPresentations.updatedBy, user.id))
    .orderBy(desc(wikiPresentations.updatedAt))
    .all()
    .map(({ elementsJson, pathJson, ...row }) => ({
      ...row,
      updatedAt: row.updatedAt.getTime(),
      elementCount: parsePresentationCanvas(elementsJson).elements.length,
      stepCount: parsePresentationSteps(pathJson).length,
    }));
}

export type PresentationListItem = ReturnType<typeof listPresentations>[number];

export function getPresentation(id: string) {
  const row = db.select().from(wikiPresentations).where(eq(wikiPresentations.id, id)).get();
  if (!row) return null;
  const { elements, settings } = parsePresentationCanvas(row.elementsJson);
  return {
    id: row.id,
    title: row.title,
    elements,
    settings,
    steps: normalizeSteps(parsePresentationSteps(row.pathJson), elements),
    updatedAt: row.updatedAt.getTime(),
  };
}

export type PresentationRecord = NonNullable<ReturnType<typeof getPresentation>>;
