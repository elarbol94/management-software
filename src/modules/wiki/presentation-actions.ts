"use server";

import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  user,
  wikiPages,
  wikiPresentationEditLeases,
  wikiPresentationRevisions,
  wikiPresentations,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { deleteAttachmentsFor, getAttachment } from "@/lib/files";
import {
  PRESENTATION_LEASE_TIMEOUT_MS,
  defaultPresentationSettings,
  isLeaseHeld,
  normalizeSteps,
  parsePresentationCanvas,
  parsePresentationSteps,
  presentationElementsSchema,
  presentationSettingsSchema,
  presentationStepsSchema,
  shouldSnapshotRevision,
} from "./lib/presentation";
import { presentationFromWikiPage } from "./lib/presentation-from-wiki";
import { presentationTemplateIds, presentationTemplates, localizedPresentationTemplate } from "./lib/presentation-templates";
import { requirePresentationAccess, presentationAccessSettings } from "./presentation-access";
import { mergePresentation } from "./lib/presentation-merge";
import { presentationSnapshotSchema } from "./lib/presentation";

const idSchema = z.string().min(1).max(64);
const titleSchema = z.string().trim().min(1).max(200);
const sessionSchema = z.string().min(8).max(200);
const templateIdSchema = z.enum(presentationTemplateIds);

function revalidatePresentations(id?: string) {
  revalidatePath("/wiki/presentations");
  if (id) revalidatePath(`/wiki/presentations/${id}`);
}

export async function createPresentation(input: { title: string; templateId?: string; locale?: string }) {
  const currentUser = await requireUserOrThrow();
  const { title, templateId, locale } = z
    .object({ title: titleSchema, templateId: templateIdSchema.optional(), locale: z.enum(["de", "en"]).default("de") })
    .parse(input);
  // templateId is validated against the enum above, so this is always a known template.
  const template = templateId ? localizedPresentationTemplate(presentationTemplates[templateId], locale) : null;
  const row = db
    .insert(wikiPresentations)
    .values({
      title,
      createdBy: currentUser.id,
      updatedBy: currentUser.id,
      ...(template
        ? { elementsJson: JSON.stringify(template.elements), pathJson: JSON.stringify(template.steps) }
        : {}),
    })
    .returning({ id: wikiPresentations.id })
    .get();
  revalidatePresentations();
  return { id: row.id };
}

/**
 * Seeds a new presentation from a wiki page's heading outline instead of a built-in
 * template: same insert as `createPresentation`, just with `presentationFromWikiPage`
 * standing in for a static template.
 */
export async function createPresentationFromWikiPage(input: { pageId: string; includeImages?: boolean }) {
  const currentUser = await requireUserOrThrow();
  const { pageId, includeImages } = z
    .object({ pageId: idSchema, includeImages: z.boolean().optional() })
    .parse(input);
  const page = db
    .select({ id: wikiPages.id, title: wikiPages.title, contentJson: wikiPages.contentJson })
    .from(wikiPages)
    .where(and(eq(wikiPages.id, pageId), isNull(wikiPages.deletedAt)))
    .get();
  if (!page) throw new Error("Page not found");
  const { elements, steps } = presentationFromWikiPage(page, { includeImages });
  const row = db
    .insert(wikiPresentations)
    .values({
      title: page.title,
      createdBy: currentUser.id,
      updatedBy: currentUser.id,
      elementsJson: JSON.stringify(elements),
      pathJson: JSON.stringify(steps),
    })
    .returning({ id: wikiPresentations.id })
    .get();
  revalidatePresentations();
  return { id: row.id };
}

export async function renamePresentation(input: { id: string; title: string; sessionId?: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: idSchema, title: titleSchema, sessionId: sessionSchema.optional() }).parse(input);
  requirePresentationAccess(data.id, currentUser, "edit");
  if (activeLease(data.id, { sessionId: data.sessionId ?? "", userId: currentUser.id })) throw new Error("Presentation is locked");
  db.update(wikiPresentations)
    .set({ title: data.title, updatedBy: currentUser.id, updatedAt: new Date() })
    .where(eq(wikiPresentations.id, data.id))
    .run();
  revalidatePresentations(data.id);
  return { savedAt: Date.now() };
}

/**
 * The lease holder, or null once their heartbeat has aged out. `takeover` is only ever a
 * request: the userId compared here comes from the lease row and the session, never from
 * the client, so a takeover can only ever reclaim the caller's own lease.
 */
function activeLease(presentationId: string, claim: { sessionId: string; userId: string; takeover?: boolean }) {
  if (presentationAccessSettings(presentationId)?.coediting) return null;
  const lease = db
    .select({
      sessionId: wikiPresentationEditLeases.sessionId,
      userId: wikiPresentationEditLeases.userId,
      heartbeatAt: wikiPresentationEditLeases.heartbeatAt,
      holderName: user.name,
    })
    .from(wikiPresentationEditLeases)
    .leftJoin(user, eq(wikiPresentationEditLeases.userId, user.id))
    .where(eq(wikiPresentationEditLeases.presentationId, presentationId))
    .get();
  const held = isLeaseHeld(
    lease ? { sessionId: lease.sessionId, userId: lease.userId, heartbeatAt: lease.heartbeatAt.getTime() } : null,
    claim,
    Date.now(),
  );
  return held && lease ? lease : null;
}

export async function acquirePresentationEditLease(input: { id: string; sessionId: string; takeover?: boolean }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: idSchema, sessionId: sessionSchema, takeover: z.boolean().optional() }).parse(input);
  requirePresentationAccess(data.id, currentUser, "edit");
  if (presentationAccessSettings(data.id)?.coediting) return { editable: true as const, expiresAt: Date.now() + PRESENTATION_LEASE_TIMEOUT_MS };
  const holder = activeLease(data.id, { sessionId: data.sessionId, userId: currentUser.id, takeover: data.takeover });
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
  requirePresentationAccess(data.id, currentUser, "edit");
  if (presentationAccessSettings(data.id)?.coediting) return { editable: true };
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
  settings?: unknown;
  title?: string;
  expectedUpdatedAt?: number;
  base?: unknown;
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      id: idSchema,
      elements: presentationElementsSchema,
      steps: presentationStepsSchema,
      sessionId: sessionSchema.optional(),
      background: z.string().max(32).default(""),
      settings: presentationSettingsSchema.default(defaultPresentationSettings),
      title: titleSchema.optional(),
      expectedUpdatedAt: z.number().int().nonnegative().optional(),
      base: presentationSnapshotSchema.optional(),
    })
    .parse(input);
  const current = db.select().from(wikiPresentations).where(eq(wikiPresentations.id, data.id)).get();
  if (!current) throw new Error("Presentation not found");
  requirePresentationAccess(data.id, currentUser, "edit");
  // No takeover on save: a stale tab whose lease was taken over must stop writing.
  if (presentationAccessSettings(data.id)?.coediting && (!data.base || data.expectedUpdatedAt === undefined)) return { locked: false as const, conflict: true as const };
  const holder = activeLease(data.id, { sessionId: data.sessionId ?? "", userId: currentUser.id });
  if (holder) return { locked: true as const, holderName: holder.holderName ?? "" };
  if (data.expectedUpdatedAt !== undefined && data.expectedUpdatedAt !== current.updatedAt.getTime()) {
    if (!presentationAccessSettings(data.id)?.coediting || !data.base) return { locked: false as const, conflict: true as const };
    const remote = { ...parsePresentationCanvas(current.elementsJson), steps: parsePresentationSteps(current.pathJson), title: current.title };
    const result = mergePresentation(data.base, { ...data, title: data.title ?? current.title }, remote);
    if (result.conflicts.length) return { locked: false as const, conflict: true as const, conflicts: result.conflicts, remote };
    const merged = presentationSnapshotSchema.safeParse(result.snapshot);
    if (!merged.success) return { locked: false as const, conflict: true as const };
    Object.assign(data, merged.data);
  }
  const savedAt = Math.max(Date.now(), current.updatedAt.getTime() + 1);

  // New media must belong to this deck or an explicitly shared wiki/library source.
  // Do not let a guessed attachment id publish another presentation's private files.
  // Preserve legacy references (including missing uploads) so they can still be edited.
  const previousMedia = new Set(parsePresentationCanvas(current.elementsJson).elements.flatMap((element) =>
    "attachmentId" in element.content ? [`${element.type}:${element.content.attachmentId}`] : []));
  for (const element of data.elements) {
    if (!("attachmentId" in element.content) || previousMedia.has(`${element.type}:${element.content.attachmentId}`)) continue;
    const attachment = getAttachment(element.content.attachmentId);
    const allowedSource = attachment && (attachment.entityType === "wikiPage" || attachment.entityType === "wikiPresentationLibrary" ||
      (attachment.entityType === "wikiPresentation" && attachment.entityId === data.id));
    if (!allowedSource || !attachment.mimeType.startsWith(`${element.type}/`)) throw new Error("Presentation media unavailable");
  }

  db.transaction(() => {
    snapshotPresentation(current, currentUser.id);
    db.update(wikiPresentations)
      .set({
        title: data.title ?? current.title,
        // The envelope form; `parsePresentationCanvas` still reads the older bare array.
        elementsJson: JSON.stringify({ elements: data.elements, background: data.background, settings: data.settings }),
        // Steps pointing at deleted elements are dropped here, so a saved path is always
        // one the player can actually fly.
        pathJson: JSON.stringify(normalizeSteps(data.steps, data.elements)),
        updatedBy: currentUser.id,
        updatedAt: new Date(savedAt),
      })
      .where(eq(wikiPresentations.id, data.id))
      .run();
  });
  revalidatePresentations(data.id);
  return { locked: false as const, conflict: false as const, savedAt,
    snapshot: { elements: data.elements, steps: normalizeSteps(data.steps, data.elements), background: data.background, settings: data.settings, title: data.title ?? current.title } };
}

/** Restoring is itself an edit, so the state being replaced is snapshotted first. */
export async function restorePresentationRevision(input: { revisionId: string; sessionId?: string; expectedUpdatedAt?: number }) {
  const currentUser = await requireUserOrThrow();
  const { revisionId, sessionId, expectedUpdatedAt } = z.object({
    revisionId: idSchema, sessionId: sessionSchema.optional(), expectedUpdatedAt: z.number().int().nonnegative().optional(),
  }).parse(input);
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
  requirePresentationAccess(current.id, currentUser, "edit");

  if (activeLease(current.id, { sessionId: sessionId ?? "", userId: currentUser.id })) throw new Error("Presentation is locked");
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== current.updatedAt.getTime()) throw new Error("Presentation changed");
  if (presentationAccessSettings(current.id)?.coediting && expectedUpdatedAt === undefined) throw new Error("Presentation changed");
  const savedAt = Math.max(Date.now(), current.updatedAt.getTime() + 1);

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
        updatedAt: new Date(savedAt),
      })
      .where(eq(wikiPresentations.id, current.id))
      .run();
  });
  revalidatePresentations(current.id);
  return { ok: true as const, savedAt, snapshot: { ...canvas, steps, title: revision.title } };
}

export async function deletePresentation(input: { id: string }) {
  const currentUser = await requireUserOrThrow();
  const { id } = z.object({ id: idSchema }).parse(input);
  requirePresentationAccess(id, currentUser, "owner");
  db.delete(wikiPresentations).where(eq(wikiPresentations.id, id)).run();
  // The canvas is gone, so its uploaded images are unreachable — remove them with it.
  deleteAttachmentsFor("wikiPresentation", id);
  revalidatePresentations(id);
  return { ok: true };
}
