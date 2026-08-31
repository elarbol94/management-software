import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { user, wikiPresentationLiveSessions, wikiPresentationRevisions, wikiPresentations } from "@/db/schema";
import { isLiveSessionStale } from "./lib/live-session";
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
  const { elements, background, settings } = parsePresentationCanvas(row.elementsJson);
  return {
    id: row.id,
    title: row.title,
    elements,
    background,
    settings,
    steps: normalizeSteps(parsePresentationSteps(row.pathJson), elements),
    updatedAt: row.updatedAt.getTime(),
  };
}

export type PresentationRecord = NonNullable<ReturnType<typeof getPresentation>>;

/**
 * The same window the page history shows: the newest 30 snapshots. Older ones stay in the
 * table — nothing prunes them — they are simply out of reach of the list.
 */
export function listPresentationRevisions(presentationId: string) {
  return db
    .select({
      id: wikiPresentationRevisions.id,
      createdAt: wikiPresentationRevisions.createdAt,
      createdByName: user.name,
    })
    .from(wikiPresentationRevisions)
    .innerJoin(user, eq(wikiPresentationRevisions.createdBy, user.id))
    .where(eq(wikiPresentationRevisions.presentationId, presentationId))
    .orderBy(desc(wikiPresentationRevisions.createdAt))
    .limit(30)
    .all()
    .map((row) => ({ ...row, createdAt: row.createdAt.getTime() }));
}

export type PresentationRevisionItem = ReturnType<typeof listPresentationRevisions>[number];

/**
 * The live session a viewer's join code points at, or null once the host stopped
 * heartbeating. Stale rows are left in place: the next start for that presentation
 * overwrites the row anyway.
 */
export function getLiveSessionByCode(code: string) {
  const row = db
    .select({
      presentationId: wikiPresentationLiveSessions.presentationId,
      code: wikiPresentationLiveSessions.code,
      stepIndex: wikiPresentationLiveSessions.stepIndex,
      heartbeatAt: wikiPresentationLiveSessions.heartbeatAt,
      hostName: user.name,
    })
    .from(wikiPresentationLiveSessions)
    .leftJoin(user, eq(wikiPresentationLiveSessions.hostUserId, user.id))
    .where(eq(wikiPresentationLiveSessions.code, code))
    .get();
  if (!row) return null;
  return {
    presentationId: row.presentationId,
    code: row.code,
    stepIndex: row.stepIndex,
    hostName: row.hostName ?? "",
    live: !isLiveSessionStale(row.heartbeatAt.getTime(), Date.now()),
  };
}

export type PresentationLiveSession = NonNullable<ReturnType<typeof getLiveSessionByCode>>;
