"use server";

import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { wikiDocumentTemplates, wikiPages } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import {
  BUILT_IN_DOCUMENT_TEMPLATES,
  normalizeDocumentSettings,
  parseDocumentSettings,
  serializeDocumentSettings,
} from "./lib/document-settings";
import { parseStoredDocument } from "./lib/tiptap";
import { parseDocumentForExport } from "./lib/suggestions";
import { stripPageSpecificContent } from "./lib/document-template";

const saveTemplateSchema = z.object({
  pageId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  includeContent: z.boolean().default(false),
  contentJson: z.string().max(2_000_000).optional(),
  documentSettingsJson: z.string().max(200_000).optional(),
});

export async function savePageAsDocumentTemplate(input: z.infer<typeof saveTemplateSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = saveTemplateSchema.parse(input);
  const page = db.select().from(wikiPages).where(eq(wikiPages.id, data.pageId)).get();
  if (!page) throw new Error("Page not found");
  const settings = parseDocumentSettings(data.documentSettingsJson ?? page.documentSettingsJson);
  const document = parseDocumentForExport(data.contentJson ?? page.contentJson);
  const content = data.includeContent ? document : stripPageSpecificContent(document);
  const row = db.insert(wikiDocumentTemplates).values({
    name: data.name,
    description: data.description,
    settingsJson: serializeDocumentSettings(settings),
    constraintsJson: JSON.stringify(settings.constraints),
    contentJson: JSON.stringify(content),
    createdBy: currentUser.id,
    updatedBy: currentUser.id,
  }).returning({ id: wikiDocumentTemplates.id }).get();
  revalidatePath("/wiki", "layout");
  return { id: row.id };
}

const applyTemplateSchema = z.object({
  pageId: z.string().min(1),
  templateId: z.string().min(1),
  applyStarterContent: z.boolean().default(true),
});

export async function applyDocumentTemplate(input: z.infer<typeof applyTemplateSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = applyTemplateSchema.parse(input);
  const page = db.select().from(wikiPages).where(and(eq(wikiPages.id, data.pageId), isNull(wikiPages.deletedAt))).get();
  if (!page) throw new Error("Page not found");

  const builtIn = BUILT_IN_DOCUMENT_TEMPLATES.find((template) => template.id === data.templateId);
  const stored = builtIn ? null : db.select().from(wikiDocumentTemplates)
    .where(and(eq(wikiDocumentTemplates.id, data.templateId), eq(wikiDocumentTemplates.createdBy, currentUser.id))).get();
  if (!builtIn && !stored) throw new Error("Template not found");

  let rawSettings: unknown = builtIn?.settings ?? null;
  let rawConstraints: unknown = builtIn?.settings.constraints ?? [];
  let templateContent = builtIn?.content ?? null;
  if (stored) {
    try { rawSettings = JSON.parse(stored.settingsJson); } catch { rawSettings = null; }
    try { rawConstraints = JSON.parse(stored.constraintsJson); } catch { rawConstraints = []; }
    templateContent = stored.contentJson ? parseStoredDocument(stored.contentJson) : null;
  }
  const settings = normalizeDocumentSettings({
    ...(rawSettings && typeof rawSettings === "object" ? rawSettings : {}),
    constraints: Array.isArray(rawConstraints) ? rawConstraints : [],
  });
  const contentJson = data.applyStarterContent && templateContent
    ? JSON.stringify(templateContent)
    : page.contentJson;
  // Apply inside the editor so its ordinary autosave owns the version, lease,
  // recovery journal, backlinks, citations, and search index updates.
  return { settings, contentJson: data.applyStarterContent ? contentJson : null };
}

export async function deleteDocumentTemplate(templateId: string) {
  const currentUser = await requireUserOrThrow();
  const id = z.string().min(1).parse(templateId);
  db.delete(wikiDocumentTemplates)
    .where(and(eq(wikiDocumentTemplates.id, id), eq(wikiDocumentTemplates.createdBy, currentUser.id)))
    .run();
  revalidatePath("/wiki", "layout");
}

