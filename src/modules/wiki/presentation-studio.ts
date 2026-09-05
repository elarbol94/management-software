import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attachments, user, wikiPresentationAccess, wikiPresentationComments, wikiPresentationLibrary, wikiPresentationMembers, wikiPresentationRevisions, wikiPresentations } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { getAttachment, getAttachmentAbsolutePath, saveAttachment, deleteAttachmentsFor } from "@/lib/files";
import { getPresentation } from "./presentation-queries";
import { presentationRole, presentationAccessSettings, presentationTokenHash, requirePresentationAccess } from "./presentation-access";
import { presentationFonts, presentationSnapshotSchema, type PresentationSnapshot } from "./lib/presentation";
import { createId } from "@paralleldrive/cuid2";

export const presentationThemeSchema = z.object({ background: z.string().regex(/^#[a-f\d]{6}$/i), foreground: z.string().regex(/^#[a-f\d]{6}$/i), accent: z.string().regex(/^#[a-f\d]{6}$/i), font: z.enum(presentationFonts) });
const idSchema = z.string().min(1).max(64);
export const presentationStudioActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("access"), restricted: z.boolean(), coediting: z.boolean() }),
  z.object({ action: z.literal("public"), enabled: z.boolean() }),
  z.object({ action: z.literal("member"), userId: idSchema, role: z.enum(["view", "comment", "edit", "remove"]) }),
  z.object({ action: z.literal("comment"), elementId: idSchema.optional(), body: z.string().trim().min(1).max(3000) }),
  z.object({ action: z.literal("resolve"), commentId: idSchema, resolved: z.boolean() }),
  z.object({ action: z.literal("theme"), name: z.string().trim().min(1).max(100), theme: presentationThemeSchema }),
  z.object({ action: z.literal("template"), name: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("applyTemplate"), libraryId: idSchema }),
  z.object({ action: z.literal("reuseAsset"), attachmentId: idSchema }),
  z.object({ action: z.literal("deleteLibrary"), libraryId: idSchema }),
  z.object({ action: z.literal("notes"), stepId: idSchema, notes: z.string().max(5000), previous: z.string().max(5000) }),
]);

function canUseAttachment(row: NonNullable<ReturnType<typeof getAttachment>>, viewer: { id: string; role?: string | null }) {
  if (row.entityType === "wikiPresentation") return Boolean(presentationRole(row.entityId, viewer));
  return row.entityType === "wikiPage" || row.entityType === "wikiPresentationLibrary";
}
async function copyAsset(id: string, targetId: string, viewer: { id: string; role?: string | null }, library = false) {
  const source = getAttachment(id);
  if (!source || !canUseAttachment(source, viewer) || !/^(image|audio|video)\//.test(source.mimeType)) throw new Error("Asset unavailable");
  const bytes = await fs.readFile(getAttachmentAbsolutePath(source.storedName));
  return saveAttachment({ file: new File([bytes], source.fileName, { type: source.mimeType }), entityType: library ? "wikiPresentationLibrary" : "wikiPresentation", entityId: targetId, userId: viewer.id });
}
async function copyDocumentAssets(snapshot: PresentationSnapshot, targetId: string, viewer: { id: string; role?: string | null }, library = false) {
  const mapped = new Map<string, string>();
  for (const element of snapshot.elements) if ("attachmentId" in element.content && !mapped.has(element.content.attachmentId)) mapped.set(element.content.attachmentId, (await copyAsset(element.content.attachmentId, targetId, viewer, library)).id);
  return { ...snapshot, elements: snapshot.elements.map((element) => "attachmentId" in element.content ? { ...element, content: { ...element.content, attachmentId: mapped.get(element.content.attachmentId)! } } : element) } as PresentationSnapshot;
}

export async function getPresentationStudio(id: string) {
  const viewer = await requireUserOrThrow();
  const role = requirePresentationAccess(id, viewer);
  const access = presentationAccessSettings(id);
  const members = role === "owner" ? db.select({ userId: wikiPresentationMembers.userId, role: wikiPresentationMembers.role }).from(wikiPresentationMembers).where(eq(wikiPresentationMembers.presentationId, id)).all() : [];
  const users = role === "owner" ? db.select({ id: user.id, name: user.name }).from(user).all() : [];
  const comments = db.select({ id: wikiPresentationComments.id, elementId: wikiPresentationComments.elementId, body: wikiPresentationComments.body, resolved: wikiPresentationComments.resolved, author: user.name }).from(wikiPresentationComments).innerJoin(user, eq(user.id, wikiPresentationComments.authorId)).where(eq(wikiPresentationComments.presentationId, id)).orderBy(desc(wikiPresentationComments.createdAt)).limit(200).all();
  const library = db.select().from(wikiPresentationLibrary).orderBy(desc(wikiPresentationLibrary.createdAt)).limit(100).all().map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind, removable: entry.createdBy === viewer.id || viewer.role === "admin", theme: entry.kind === "theme" ? presentationThemeSchema.parse(JSON.parse(entry.documentJson)) : undefined }));
  const assets = db.select().from(attachments).orderBy(desc(attachments.createdAt)).all().filter((entry) => entry.mimeType.startsWith("image/") && canUseAttachment(entry, viewer)).slice(0, 200).map((entry) => ({ id: entry.id, name: entry.fileName }));
  return { role, access: { restricted: access?.restricted ?? false, coediting: access?.coediting ?? false, publicEnabled: Boolean(access?.publicTokenHash) }, members, users, comments, library, assets };
}

export async function changePresentationStudio(id: string, input: unknown) {
  const viewer = await requireUserOrThrow();
  const data = presentationStudioActionSchema.parse(input);
  const minimum = ["access", "public", "member"].includes(data.action) ? "owner" : ["comment", "resolve"].includes(data.action) ? "comment" : "edit";
  requirePresentationAccess(id, viewer, minimum);
  if (data.action === "access") {
    db.insert(wikiPresentationAccess).values({ presentationId: id, restricted: data.restricted, coediting: data.coediting }).onConflictDoUpdate({ target: wikiPresentationAccess.presentationId, set: { restricted: data.restricted, coediting: data.coediting } }).run();
  } else if (data.action === "public") {
    const token = data.enabled ? randomBytes(32).toString("hex") : null;
    const publicTokenHash = token ? presentationTokenHash(token) : null;
    db.insert(wikiPresentationAccess).values({ presentationId: id, publicTokenHash }).onConflictDoUpdate({ target: wikiPresentationAccess.presentationId, set: { publicTokenHash } }).run();
    return { token };
  } else if (data.action === "member") {
    if (!db.select({ id: user.id }).from(user).where(eq(user.id, data.userId)).get()) throw new Error("Unknown user");
    if (data.role === "remove") db.delete(wikiPresentationMembers).where(and(eq(wikiPresentationMembers.presentationId, id), eq(wikiPresentationMembers.userId, data.userId))).run();
    else db.insert(wikiPresentationMembers).values({ presentationId: id, userId: data.userId, role: data.role }).onConflictDoUpdate({ target: [wikiPresentationMembers.presentationId, wikiPresentationMembers.userId], set: { role: data.role } }).run();
  } else if (data.action === "comment") {
    const presentation = getPresentation(id, viewer)!;
    if (data.elementId && !presentation.elements.some((element) => element.id === data.elementId)) throw new Error("Object no longer exists");
    db.insert(wikiPresentationComments).values({ presentationId: id, elementId: data.elementId, body: data.body, authorId: viewer.id }).run();
  } else if (data.action === "resolve") {
    db.update(wikiPresentationComments).set({ resolved: data.resolved }).where(and(eq(wikiPresentationComments.id, data.commentId), eq(wikiPresentationComments.presentationId, id))).run();
  } else if (data.action === "theme") {
    db.insert(wikiPresentationLibrary).values({ name: data.name, kind: "theme", documentJson: JSON.stringify(data.theme), createdBy: viewer.id }).run();
  } else if (data.action === "template") {
    const libraryId = createId();
    try {
      const source = getPresentation(id, viewer)!;
      const snapshot = await copyDocumentAssets({ ...source, steps: source.steps.map((step) => ({ ...step, notes: undefined })) }, libraryId, viewer, true);
      db.insert(wikiPresentationLibrary).values({ id: libraryId, name: data.name, kind: "template", documentJson: JSON.stringify(snapshot), createdBy: viewer.id }).run();
    } catch (error) { deleteAttachmentsFor("wikiPresentationLibrary", libraryId); throw error; }
  } else if (data.action === "applyTemplate") {
    const source = db.select().from(wikiPresentationLibrary).where(eq(wikiPresentationLibrary.id, data.libraryId)).get();
    if (source?.kind !== "template") throw new Error("Template unavailable");
    return { snapshot: await copyDocumentAssets(presentationSnapshotSchema.parse(JSON.parse(source.documentJson)), id, viewer) };
  } else if (data.action === "reuseAsset") {
    return { attachmentId: (await copyAsset(data.attachmentId, id, viewer)).id };
  } else if (data.action === "deleteLibrary") {
    const entry = db.select().from(wikiPresentationLibrary).where(eq(wikiPresentationLibrary.id, data.libraryId)).get();
    if (!entry || (entry.createdBy !== viewer.id && viewer.role !== "admin")) throw new Error("Library access denied");
    db.delete(wikiPresentationLibrary).where(eq(wikiPresentationLibrary.id, entry.id)).run();
    deleteAttachmentsFor("wikiPresentationLibrary", entry.id);
  } else if (data.action === "notes") {
    // Update only this note in a synchronous transaction: never overwrite canvas edits.
    const presentation = getPresentation(id, viewer)!;
    const step = presentation.steps.find((step) => step.id === data.stepId);
    if (!step || (step.notes ?? "") !== data.previous) return { conflict: true };
    const steps = presentation.steps.map((step) => step.id === data.stepId ? { ...step, notes: data.notes } : step);
    db.transaction(() => {
      const previous = db.select().from(wikiPresentations).where(eq(wikiPresentations.id, id)).get()!;
      db.insert(wikiPresentationRevisions).values({ presentationId: id, title: previous.title, elementsJson: previous.elementsJson, pathJson: previous.pathJson, createdBy: viewer.id }).run();
      db.update(wikiPresentations).set({ pathJson: JSON.stringify(steps), updatedBy: viewer.id, updatedAt: new Date(Math.max(Date.now(), presentation.updatedAt + 1)) }).where(eq(wikiPresentations.id, id)).run();
    });
  }
  return { ok: true };
}
