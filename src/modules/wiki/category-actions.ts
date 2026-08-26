"use server";

import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { evidenceLinks, wikiCategories } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";

function revalidateCategories() {
  revalidatePath("/wiki/categories", "page");
}

const nameSchema = z.string().trim().min(1).max(120);

export async function createCategory(input: { name: string; parentId?: string | null }) {
  const user = await requireUserOrThrow();
  const data = z.object({ name: nameSchema, parentId: z.string().min(1).nullish() }).parse(input);
  const parentId = data.parentId ?? null;
  if (parentId && !db.select({ id: wikiCategories.id }).from(wikiCategories).where(eq(wikiCategories.id, parentId)).get()) {
    throw new Error("Parent category not found");
  }
  // Append to the end of its level rather than colliding on 0.
  const siblings = db
    .select({ sortOrder: wikiCategories.sortOrder })
    .from(wikiCategories)
    .where(parentId ? eq(wikiCategories.parentId, parentId) : isNull(wikiCategories.parentId))
    .all();
  const sortOrder = siblings.reduce((highest, row) => Math.max(highest, row.sortOrder), -1) + 1;
  const row = db.insert(wikiCategories).values({
    name: data.name, parentId, sortOrder, createdBy: user.id,
  }).returning({ id: wikiCategories.id }).get();
  revalidateCategories();
  return { id: row.id };
}

export async function renameCategory(input: { id: string; name: string; description?: string }) {
  await requireUserOrThrow();
  const data = z.object({
    id: z.string().min(1),
    name: nameSchema,
    description: z.string().max(2_000).optional(),
  }).parse(input);
  db.update(wikiCategories).set({
    name: data.name,
    ...(data.description === undefined ? {} : { description: data.description }),
    updatedAt: new Date(),
  }).where(eq(wikiCategories.id, data.id)).run();
  revalidateCategories();
}

/**
 * Removes a category and its descendants. The evidence itself is untouched: only the
 * links filing it here go, because an annotation belongs to its source, not to an
 * outline entry that happened to reference it.
 */
export async function deleteCategory(id: string) {
  await requireUserOrThrow();
  const categoryId = z.string().min(1).parse(id);
  const all = db.select({ id: wikiCategories.id, parentId: wikiCategories.parentId }).from(wikiCategories).all();
  const doomed = new Set([categoryId]);
  // The children cascade in SQL, but their evidence links do not, so collect them here.
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of all) {
      if (row.parentId && doomed.has(row.parentId) && !doomed.has(row.id)) {
        doomed.add(row.id);
        grew = true;
      }
    }
  }
  db.transaction(() => {
    db.delete(evidenceLinks)
      .where(and(eq(evidenceLinks.targetType, "wikiCategory"), inArray(evidenceLinks.targetId, [...doomed])))
      .run();
    db.delete(wikiCategories).where(eq(wikiCategories.id, categoryId)).run();
  });
  revalidateCategories();
}

export async function reorderCategories(input: { parentId: string | null; orderedIds: string[] }) {
  await requireUserOrThrow();
  const data = z.object({
    parentId: z.string().min(1).nullable(),
    orderedIds: z.array(z.string().min(1)).min(1).max(500),
  }).parse(input);
  const rows = db
    .select({ id: wikiCategories.id, parentId: wikiCategories.parentId })
    .from(wikiCategories)
    .where(inArray(wikiCategories.id, data.orderedIds))
    .all();
  if (rows.length !== data.orderedIds.length) throw new Error("Category not found");
  if (rows.some((row) => (row.parentId ?? null) !== data.parentId)) {
    throw new Error("Categories do not share the given parent");
  }
  db.transaction(() => {
    data.orderedIds.forEach((id, index) => {
      db.update(wikiCategories).set({ sortOrder: index, updatedAt: new Date() }).where(eq(wikiCategories.id, id)).run();
    });
  });
  revalidateCategories();
}

/** Moves a passage from one outline entry to another without touching the annotation. */
export async function moveEvidenceToCategory(input: { linkId: string; categoryId: string }) {
  await requireUserOrThrow();
  const data = z.object({ linkId: z.string().min(1), categoryId: z.string().min(1) }).parse(input);
  if (!db.select({ id: wikiCategories.id }).from(wikiCategories).where(eq(wikiCategories.id, data.categoryId)).get()) {
    throw new Error("Category not found");
  }
  db.update(evidenceLinks).set({ targetId: data.categoryId }).where(eq(evidenceLinks.id, data.linkId)).run();
  revalidateCategories();
}
