"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { wikiPresentations } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { deleteAttachmentsFor } from "@/lib/files";
import {
  normalizeSteps,
  presentationElementsSchema,
  presentationStepsSchema,
} from "./lib/presentation";

const idSchema = z.string().min(1).max(64);
const titleSchema = z.string().trim().min(1).max(200);

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

export async function savePresentation(input: { id: string; elements: unknown; steps: unknown }) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({ id: idSchema, elements: presentationElementsSchema, steps: presentationStepsSchema })
    .parse(input);
  const result = db
    .update(wikiPresentations)
    .set({
      elementsJson: JSON.stringify(data.elements),
      // Steps pointing at deleted elements are dropped here, so a saved path is always
      // one the player can actually fly.
      pathJson: JSON.stringify(normalizeSteps(data.steps, data.elements)),
      updatedBy: currentUser.id,
      updatedAt: new Date(),
    })
    .where(eq(wikiPresentations.id, data.id))
    .returning({ id: wikiPresentations.id })
    .get();
  if (!result) throw new Error("Presentation not found");
  revalidatePresentations(data.id);
  return { savedAt: Date.now() };
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
