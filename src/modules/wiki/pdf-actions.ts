"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, sqlite } from "@/db";
import { evidenceLinks, wikiPdfAnnotationComments, wikiPdfAnnotations, wikiPdfDocuments } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { UPLOADS_PATH } from "@/lib/files";
import { evidenceTargetTypes } from "./lib/pdf-evidence";
import { retryPdfDocument as queuePdfRetry } from "./pdf-processing";

const rectSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine((rect) => rect.x + rect.width <= 1.00001 && rect.y + rect.height <= 1.00001, "Geometry exceeds page bounds");

const annotationSchema = z.object({
  documentId: z.string().min(1), pageNumber: z.number().int().positive(),
  kind: z.enum(["text", "region", "bookmark"]),
  selectedText: z.string().max(20_000).default(""), note: z.string().max(10_000).default(""),
  label: z.string().max(200).default(""),
  geometry: z.array(rectSchema).max(200).default([]), previewDataUrl: z.string().max(8_000_000).optional(),
}).superRefine((value, context) => {
  if (value.kind !== "bookmark" && value.geometry.length === 0) context.addIssue({ code: "custom", message: "Annotation geometry is required" });
  if (value.kind === "text" && !value.selectedText.trim()) context.addIssue({ code: "custom", message: "Selected text is required" });
});

function targetExists(type: (typeof evidenceTargetTypes)[number], id: string) {
  const tables: Record<typeof type, string> = {
    wikiPage: "wiki_pages", project: "projects", task: "tasks", accountingEntry: "entries",
    invoice: "invoices", fundingProject: "funding_projects", fundingBudgetItem: "funding_budget_items",
    fundingBookingAllocation: "funding_booking_allocations",
  };
  return Boolean(sqlite.prepare(`SELECT id FROM ${tables[type]} WHERE id = ? LIMIT 1`).get(id));
}

async function savePreview(annotationId: string, documentId: string, dataUrl?: string) {
  if (!dataUrl) return "";
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid annotation preview");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Annotation preview is too large");
  const extension = match[1] === "jpeg" ? "jpg" : "png";
  const storedName = `derived/${documentId}/annotations/${annotationId}.${extension}`;
  const absolute = path.join(UPLOADS_PATH, storedName);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, bytes);
  return storedName;
}

export async function createPdfAnnotation(input: z.input<typeof annotationSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = annotationSchema.parse(input);
  const document = db.select({ id: wikiPdfDocuments.id, sourceId: wikiPdfDocuments.sourceId, pageCount: wikiPdfDocuments.pageCount })
    .from(wikiPdfDocuments).where(eq(wikiPdfDocuments.id, data.documentId)).get();
  if (!document || data.pageNumber > document.pageCount) throw new Error("PDF page not found");
  const id = createId();
  const previewStoredName = await savePreview(id, data.documentId, data.previewDataUrl);
  db.insert(wikiPdfAnnotations).values({
    id, sourceId: document.sourceId, documentId: data.documentId, pageNumber: data.pageNumber,
    kind: data.kind, selectedText: data.selectedText.trim(), note: data.note.trim(), label: data.label.trim(),
    color: "yellow", geometryJson: JSON.stringify(data.geometry), previewStoredName,
    createdBy: currentUser.id, updatedBy: currentUser.id,
  }).run();
  revalidatePath(`/wiki/sources/${document.sourceId}`, "page");
  return { id };
}

export async function extendPdfAnnotation(input: { id: string; geometry: z.input<typeof rectSchema>[]; selectedText: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: z.string().min(1), geometry: z.array(rectSchema).min(1).max(200), selectedText: z.string().max(20_000) }).parse(input);
  const annotation = db.select().from(wikiPdfAnnotations).where(and(eq(wikiPdfAnnotations.id, data.id), isNull(wikiPdfAnnotations.deletedAt))).get();
  if (!annotation) throw new Error("Annotation not found");
  if (annotation.createdBy !== currentUser.id && currentUser.role !== "admin") throw new Error("Forbidden");
  if (annotation.kind === "bookmark") throw new Error("Bookmarks cannot be extended");
  if (annotation.kind === "text" && !data.selectedText.trim()) throw new Error("Selected text is required");
  db.update(wikiPdfAnnotations).set({ geometryJson: JSON.stringify(data.geometry), selectedText: data.selectedText.trim(), updatedBy: currentUser.id, updatedAt: new Date() })
    .where(eq(wikiPdfAnnotations.id, data.id)).run();
  revalidatePath("/wiki/sources/" + annotation.sourceId, "page");
}

export async function updatePdfAnnotation(input: { id: string; note: string; label: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: z.string().min(1), note: z.string().max(10_000), label: z.string().max(200) }).parse(input);
  const annotation = db.select().from(wikiPdfAnnotations).where(and(eq(wikiPdfAnnotations.id, data.id), isNull(wikiPdfAnnotations.deletedAt))).get();
  if (!annotation) throw new Error("Annotation not found");
  if (annotation.createdBy !== currentUser.id && currentUser.role !== "admin") throw new Error("Forbidden");
  db.update(wikiPdfAnnotations).set({ note: data.note.trim(), label: data.label.trim(), updatedBy: currentUser.id, updatedAt: new Date() })
    .where(eq(wikiPdfAnnotations.id, data.id)).run();
  revalidatePath(`/wiki/sources/${annotation.sourceId}`, "page");
}

export async function deletePdfAnnotation(id: string) {
  const currentUser = await requireUserOrThrow();
  const annotation = db.select().from(wikiPdfAnnotations).where(and(eq(wikiPdfAnnotations.id, id), isNull(wikiPdfAnnotations.deletedAt))).get();
  if (!annotation) return;
  if (annotation.createdBy !== currentUser.id && currentUser.role !== "admin") throw new Error("Forbidden");
  db.update(wikiPdfAnnotations).set({ deletedAt: new Date(), updatedBy: currentUser.id, updatedAt: new Date() })
    .where(eq(wikiPdfAnnotations.id, id)).run();
  revalidatePath(`/wiki/sources/${annotation.sourceId}`, "page");
}

export async function restorePdfAnnotation(id: string) {
  const currentUser = await requireUserOrThrow();
  const annotation = db.select().from(wikiPdfAnnotations).where(eq(wikiPdfAnnotations.id, z.string().min(1).parse(id))).get();
  if (!annotation?.deletedAt) return;
  if (annotation.createdBy !== currentUser.id && currentUser.role !== "admin") throw new Error("Forbidden");
  db.update(wikiPdfAnnotations).set({ deletedAt: null, updatedBy: currentUser.id, updatedAt: new Date() })
    .where(eq(wikiPdfAnnotations.id, annotation.id)).run();
  revalidatePath(`/wiki/sources/${annotation.sourceId}`, "page");
}

export async function createPdfAnnotationComment(input: { annotationId: string; body: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ annotationId: z.string().min(1), body: z.string().trim().min(1).max(10_000) }).parse(input);
  const annotation = db.select({ id: wikiPdfAnnotations.id, sourceId: wikiPdfAnnotations.sourceId }).from(wikiPdfAnnotations)
    .where(and(eq(wikiPdfAnnotations.id, data.annotationId), isNull(wikiPdfAnnotations.deletedAt))).get();
  if (!annotation) throw new Error("Annotation not found");
  const id = createId(); const createdAt = new Date();
  db.insert(wikiPdfAnnotationComments).values({ id, annotationId: annotation.id, body: data.body, createdBy: currentUser.id, createdAt }).run();
  revalidatePath(`/wiki/sources/${annotation.sourceId}`, "page");
  const { ensureUserMarkColor } = await import("@/lib/user-mark-colors.server");
  return { id, createdAt: createdAt.toISOString(), createdBy: currentUser.id, createdByName: currentUser.name, createdByMarkColor: ensureUserMarkColor(currentUser.id), body: data.body };
}

export async function updatePdfAnnotationComment(input: { id: string; body: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ id: z.string().min(1), body: z.string().trim().min(1).max(10_000) }).parse(input);
  const comment = db.select({ id: wikiPdfAnnotationComments.id, createdBy: wikiPdfAnnotationComments.createdBy, sourceId: wikiPdfAnnotations.sourceId })
    .from(wikiPdfAnnotationComments).innerJoin(wikiPdfAnnotations, eq(wikiPdfAnnotationComments.annotationId, wikiPdfAnnotations.id))
    .where(and(eq(wikiPdfAnnotationComments.id, data.id), isNull(wikiPdfAnnotations.deletedAt))).get();
  if (!comment) throw new Error("Comment not found");
  if (comment.createdBy !== currentUser.id && currentUser.role !== "admin") throw new Error("Forbidden");
  db.update(wikiPdfAnnotationComments).set({ body: data.body }).where(eq(wikiPdfAnnotationComments.id, comment.id)).run();
  revalidatePath(`/wiki/sources/${comment.sourceId}`, "page");
  return { id: comment.id, body: data.body };
}

export async function linkPdfEvidence(input: { annotationId: string; targetType: (typeof evidenceTargetTypes)[number]; targetId: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ annotationId: z.string().min(1), targetType: z.enum(evidenceTargetTypes), targetId: z.string().min(1) }).parse(input);
  const annotation = db.select({ id: wikiPdfAnnotations.id }).from(wikiPdfAnnotations)
    .where(and(eq(wikiPdfAnnotations.id, data.annotationId), isNull(wikiPdfAnnotations.deletedAt))).get();
  if (!annotation) throw new Error("Annotation not found");
  if (!targetExists(data.targetType, data.targetId)) throw new Error("Evidence target not found");
  db.insert(evidenceLinks).values({ ...data, createdBy: currentUser.id }).onConflictDoNothing().run();
  revalidatePath("/", "layout");
}

export async function unlinkPdfEvidence(linkId: string) {
  const currentUser = await requireUserOrThrow();
  const id = z.string().min(1).parse(linkId);
  const link = db.select({ createdBy: evidenceLinks.createdBy }).from(evidenceLinks).where(eq(evidenceLinks.id, id)).get();
  if (!link) return;
  if (link.createdBy !== currentUser.id && currentUser.role !== "admin") throw new Error("Forbidden");
  db.delete(evidenceLinks).where(eq(evidenceLinks.id, id)).run();
  // Evidence targets span eight modules, so the whole layout has to revalidate.
  revalidatePath("/", "layout");
}

export async function retryPdfProcessing(documentId: string) {
  await requireUserOrThrow();
  const id = z.string().min(1).parse(documentId);
  const document = db.select({ sourceId: wikiPdfDocuments.sourceId }).from(wikiPdfDocuments).where(eq(wikiPdfDocuments.id, id)).get();
  if (!document) throw new Error("PDF not found");
  queuePdfRetry(id);
  revalidatePath(`/wiki/sources/${document.sourceId}`, "page");
}
