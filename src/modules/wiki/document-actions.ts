"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { wikiDocumentTemplates, wikiPageRevisions, wikiPages } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import {
  BUILT_IN_DOCUMENT_TEMPLATES,
  normalizeDocumentSettings,
  serializeDocumentSettings,
} from "./lib/document-settings";
import { extractText, parseStoredDocument, type TiptapNode } from "./lib/tiptap";

function stripPageSpecificContent(doc: TiptapNode): TiptapNode {
  function clean(node: TiptapNode, preserveText = false): TiptapNode | null {
    if (["citation", "pdfEvidence"].includes(node.type ?? "")) return null;
    if (node.text !== undefined) return preserveText ? { ...node, marks: node.marks?.filter((mark) => mark.type !== "comment") } : null;
    const keepText = node.type === "heading" || node.type === "footnoteDefinition";
    const content = (node.content ?? [])
      .map((child) => clean(child, preserveText || keepText))
      .filter((child): child is TiptapNode => Boolean(child));
    const cleaned: TiptapNode = {
      ...node,
      ...(content.length ? { content } : {}),
    };
    if (node.type === "paragraph" && content.length === 0) return { type: "paragraph" };
    return cleaned;
  }
  return clean(doc) ?? { type: "doc", content: [{ type: "paragraph" }] };
}

const saveTemplateSchema = z.object({
  pageId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  includeContent: z.boolean().default(false),
});

export async function savePageAsDocumentTemplate(input: z.infer<typeof saveTemplateSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = saveTemplateSchema.parse(input);
  const page = db.select().from(wikiPages).where(eq(wikiPages.id, data.pageId)).get();
  if (!page) throw new Error("Page not found");
  const settings = normalizeDocumentSettings(
    page.documentSettingsJson ? JSON.parse(page.documentSettingsJson) : null,
  );
  const document = parseStoredDocument(page.contentJson);
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
  const page = db.select().from(wikiPages).where(eq(wikiPages.id, data.pageId)).get();
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
  const contentText = extractText(parseStoredDocument(contentJson));

  db.transaction(() => {
    db.insert(wikiPageRevisions).values({
      pageId: page.id,
      version: page.version,
      title: page.title,
      contentJson: page.contentJson,
      status: page.status,
      citationLocale: page.citationLocale,
      citationStyle: page.citationStyle,
      documentMode: page.documentMode,
      documentSettingsJson: page.documentSettingsJson,
      documentTemplateId: page.documentTemplateId,
      kind: "autosave",
      createdBy: currentUser.id,
    }).run();
    db.update(wikiPages).set({
      contentJson,
      contentText,
      documentMode: true,
      documentSettingsJson: serializeDocumentSettings(settings),
      documentTemplateId: builtIn ? null : stored!.id,
      version: page.version + 1,
      updatedBy: currentUser.id,
      updatedAt: new Date(),
    }).where(eq(wikiPages.id, page.id)).run();
  });
  revalidatePath("/wiki", "layout");
  return { applied: true as const };
}

export async function deleteDocumentTemplate(templateId: string) {
  const currentUser = await requireUserOrThrow();
  const id = z.string().min(1).parse(templateId);
  db.delete(wikiDocumentTemplates)
    .where(and(eq(wikiDocumentTemplates.id, id), eq(wikiDocumentTemplates.createdBy, currentUser.id)))
    .run();
  revalidatePath("/wiki", "layout");
}

