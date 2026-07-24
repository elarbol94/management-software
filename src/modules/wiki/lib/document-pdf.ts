import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiPages } from "@/db/schema";
import { getAttachment, getAttachmentAbsolutePath } from "@/lib/files";
import { formatBibliographyEntry } from "./citations";
import { parseDocumentSettings } from "./document-settings";
import { renderDocumentHtml, type RenderedDocument } from "./document-renderer";
import { parseStoredDocument } from "./tiptap";
import { getCitationSourcesForPage } from "../research-queries";
import { renderDocumentPdfBytes } from "./document-pdf-engine";

const EXPORT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function dataUriForAttachment(attachmentId: string, pageId: string) {
  const attachment = getAttachment(attachmentId);
  if (
    !attachment
    || attachment.entityType !== "wikiPage"
    || attachment.entityId !== pageId
    || !EXPORT_IMAGE_TYPES.has(attachment.mimeType)
  ) return null;
  const absolute = getAttachmentAbsolutePath(attachment.storedName);
  if (!fs.existsSync(absolute)) return null;
  return `data:${attachment.mimeType};base64,${fs.readFileSync(absolute).toString("base64")}`;
}

export async function renderStoredWikiDocument(pageId: string): Promise<{
  page: typeof wikiPages.$inferSelect;
  rendered: RenderedDocument;
}> {
  const page = db.select().from(wikiPages).where(eq(wikiPages.id, pageId)).get();
  if (!page || page.deletedAt) throw new Error("Page not found");
  const settings = parseDocumentSettings(page.documentSettingsJson);
  const doc = parseStoredDocument(page.contentJson);
  const references = getCitationSourcesForPage(page.id).map(formatBibliographyEntry);
  const rendered = await renderDocumentHtml({
    title: page.title,
    doc,
    settings,
    references,
    resolveAsset: async ({ attachmentId, src }) => {
      const routeId = src.match(/^\/api\/files\/([^/?#]+)/)?.[1];
      const id = attachmentId || routeId || "";
      return id ? dataUriForAttachment(id, page.id) : src.startsWith("data:image/") ? src : null;
    },
  });
  return { page, rendered };
}

export async function generateWikiDocumentPdf(pageId: string) {
  const { page: storedPage, rendered } = await renderStoredWikiDocument(pageId);
  const settings = parseDocumentSettings(storedPage.documentSettingsJson);
  const pdf = await renderDocumentPdfBytes({
    rendered,
    settings,
    metadata: {
      title: storedPage.title,
      author: settings.metadata.author,
      subject: settings.metadata.subject,
      keywords: settings.metadata.keywords,
    },
  });
  return { pdf, page: storedPage, rendered };
}
