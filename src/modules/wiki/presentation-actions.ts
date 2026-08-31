"use server";

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  user,
  wikiPresentationEditLeases,
  wikiPresentationRevisions,
  wikiPresentations,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { deleteAttachmentsFor } from "@/lib/files";
import {
  PRESENTATION_LEASE_TIMEOUT_MS,
  isLeaseHeldByOther,
  normalizeSteps,
  parsePresentationCanvas,
  parsePresentationSteps,
  presentationElementsSchema,
  presentationStepsSchema,
  shouldSnapshotRevision,
} from "./lib/presentation";

const idSchema = z.string().min(1).max(64);
const titleSchema = z.string().trim().min(1).max(200);
const sessionSchema = z.string().min(8).max(200);

function revalidatePresentations(id?: string) {
  revalidatePath("/wiki/presentations");
  if (id) revalidatePath(`/wiki/presentations/${id}`);
}

export async function createPresentation(input: { title: string }) {
  const currentUser = await requireUserOrThrow();
  const { title } = z.object({ title: titleSchema }).parse(input);
  const row = db
    .insert(wikiPresentations)
    .values({ title, createdBy: currentUser.id, updatedBy: currentUser.id })
    .returning({ id: wikiPresentations.id })
    .get();
  revalidatePresentations();
  return { id: row.id };
}

export async function renamePresentation(input: { id: string; title: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: idSchema, title: titleSchema }).parse(input);
  db.update(wikiPresentations)
    .set({ title: data.title, updatedBy: currentUser.id, updatedAt: new Date() })
    .where(eq(wikiPresentations.id, data.id))
    .run();
  revalidatePresentations(data.id);
  return { savedAt: Date.now() };
}

/** The lease holder, or null once their heartbeat has aged out. */
function activeLease(presentationId: string, sessionId: string) {
  const lease = db
    .select({
      sessionId: wikiPresentationEditLeases.sessionId,
      heartbeatAt: wikiPresentationEditLeases.heartbeatAt,
      holderName: user.name,
    })
    .from(wikiPresentationEditLeases)
    .leftJoin(user, eq(wikiPresentationEditLeases.userId, user.id))
    .where(eq(wikiPresentationEditLeases.presentationId, presentationId))
    .get();
  const held = isLeaseHeldByOther(
    lease ? { sessionId: lease.sessionId, heartbeatAt: lease.heartbeatAt.getTime() } : null,
    sessionId,
    Date.now(),
  );
  return held && lease ? lease : null;
}

export async function acquirePresentationEditLease(input: { id: string; sessionId: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: idSchema, sessionId: sessionSchema }).parse(input);
  const holder = activeLease(data.id, data.sessionId);
  if (holder) return { editable: false as const, holderName: holder.holderName ?? "" };
  const now = new Date();
  db.insert(wikiPresentationEditLeases)
    .values({ presentationId: data.id, sessionId: data.sessionId, userId: currentUser.id, acquiredAt: now, heartbeatAt: now })
    .onConflictDoUpdate({
      target: wikiPresentationEditLeases.presentationId,
      set: { sessionId: data.sessionId, userId: currentUser.id, acquiredAt: now, heartbeatAt: now },
    })
    .run();
  return { editable: true as const, expiresAt: now.getTime() + PRESENTATION_LEASE_TIMEOUT_MS };
}

export async function heartbeatPresentationEditLease(input: { id: string; sessionId: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: idSchema, sessionId: sessionSchema }).parse(input);
  const updated = db
    .update(wikiPresentationEditLeases)
    .set({ heartbeatAt: new Date() })
    .where(and(
      eq(wikiPresentationEditLeases.presentationId, data.id),
      eq(wikiPresentationEditLeases.sessionId, data.sessionId),
      eq(wikiPresentationEditLeases.userId, currentUser.id),
    ))
    .returning({ presentationId: wikiPresentationEditLeases.presentationId })
    .get();
  return { editable: Boolean(updated) };
}

export async function releasePresentationEditLease(input: { id: string; sessionId: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: idSchema, sessionId: sessionSchema }).parse(input);
  db.delete(wikiPresentationEditLeases)
    .where(and(
      eq(wikiPresentationEditLeases.presentationId, data.id),
      eq(wikiPresentationEditLeases.sessionId, data.sessionId),
      eq(wikiPresentationEditLeases.userId, currentUser.id),
    ))
    .run();
  return { released: true as const };
}

/**
 * Same policy as the wiki page editor: one snapshot per author per throttle window, so a
 * long editing session leaves a readable history instead of one entry per autosave.
 */
function snapshotPresentation(
  presentation: { id: string; title: string; elementsJson: string; pathJson: string },
  userId: string,
  force = false,
) {
  const last = db
    .select({ createdAt: wikiPresentationRevisions.createdAt })
    .from(wikiPresentationRevisions)
    .where(and(
      eq(wikiPresentationRevisions.presentationId, presentation.id),
      eq(wikiPresentationRevisions.createdBy, userId),
    ))
    .orderBy(desc(wikiPresentationRevisions.createdAt))
    .get();
  if (!force && !shouldSnapshotRevision(last?.createdAt.getTime() ?? null, Date.now())) return;
  db.insert(wikiPresentationRevisions)
    .values({
      presentationId: presentation.id,
      title: presentation.title,
      elementsJson: presentation.elementsJson,
      pathJson: presentation.pathJson,
      createdBy: userId,
    })
    .run();
}

export async function savePresentation(input: {
  id: string;
  elements: unknown;
  steps: unknown;
  sessionId?: string;
  background?: unknown;
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      id: idSchema,
      elements: presentationElementsSchema,
      steps: presentationStepsSchema,
      sessionId: sessionSchema.optional(),
      background: z.string().max(32).default(""),
    })
    .parse(input);
  const current = db.select().from(wikiPresentations).where(eq(wikiPresentations.id, data.id)).get();
  if (!current) throw new Error("Presentation not found");
  const holder = data.sessionId ? activeLease(data.id, data.sessionId) : null;
  if (holder) return { locked: true as const, holderName: holder.holderName ?? "" };

  db.transaction(() => {
    snapshotPresentation(current, currentUser.id);
    db.update(wikiPresentations)
      .set({
        // The envelope form; `parsePresentationCanvas` still reads the older bare array.
        elementsJson: JSON.stringify({ elements: data.elements, background: data.background }),
        // Steps pointing at deleted elements are dropped here, so a saved path is always
        // one the player can actually fly.
        pathJson: JSON.stringify(normalizeSteps(data.steps, data.elements)),
        updatedBy: currentUser.id,
        updatedAt: new Date(),
      })
      .where(eq(wikiPresentations.id, data.id))
      .run();
  });
  revalidatePresentations(data.id);
  return { locked: false as const, savedAt: Date.now() };
}

/** Restoring is itself an edit, so the state being replaced is snapshotted first. */
export async function restorePresentationRevision(input: { revisionId: string }) {
  const currentUser = await requireUserOrThrow();
  const { revisionId } = z.object({ revisionId: idSchema }).parse(input);
  const revision = db
    .select()
    .from(wikiPresentationRevisions)
    .where(eq(wikiPresentationRevisions.id, revisionId))
    .get();
  if (!revision) throw new Error("Revision not found");
  const current = db
    .select()
    .from(wikiPresentations)
    .where(eq(wikiPresentations.id, revision.presentationId))
    .get();
  if (!current) throw new Error("Presentation not found");

  const canvas = parsePresentationCanvas(revision.elementsJson);
  const steps = normalizeSteps(parsePresentationSteps(revision.pathJson), canvas.elements);
  db.transaction(() => {
    snapshotPresentation(current, currentUser.id, true);
    db.update(wikiPresentations)
      .set({
        title: revision.title,
        elementsJson: JSON.stringify(canvas),
        pathJson: JSON.stringify(steps),
        updatedBy: currentUser.id,
        updatedAt: new Date(),
      })
      .where(eq(wikiPresentations.id, current.id))
      .run();
  });
  revalidatePresentations(current.id);
  return { ok: true as const };
}

export async function deletePresentation(input: { id: string }) {
  await requireUserOrThrow();
  const { id } = z.object({ id: idSchema }).parse(input);
  db.delete(wikiPresentations).where(eq(wikiPresentations.id, id)).run();
  // The canvas is gone, so its uploaded images are unreachable — remove them with it.
  deleteAttachmentsFor("wikiPresentation", id);
  revalidatePresentations(id);
  return { ok: true };
}
