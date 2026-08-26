import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiPages, wikiSvgAssets } from "@/db/schema";
import { getAttachment, getAttachmentAbsolutePath } from "@/lib/files";
import { formatBibliography } from "./citations";
import { localizeDocumentSettings, parseDocumentSettings } from "./document-settings";
import { renderDocumentHtml, type RenderedDocument } from "./document-renderer";
import { parseStoredDocument } from "./tiptap";
import { getCitationSourcesForPage } from "../research-queries";
import { renderDocumentPdfBytes } from "./document-pdf-engine";
import type { WikiTypographySettingsV1 } from "./wiki-typography";
import { renderSvgAsset } from "../svg-assets";

const EXPORT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

function dataUriForAttachment(attachmentId: string, pageId: string) {
  const attachment = getAttachment(attachmentId);
  if (
    !attachment
    || attachment.entityType !== "wikiPage"
    || attachment.entityId !== pageId
    || !EXPORT_IMAGE_TYPES.has(attachment.mimeType)
  ) return null;
  if (attachment.mimeType === "image/svg+xml") {
    const asset = db.select({ id: wikiSvgAssets.id }).from(wikiSvgAssets)
      .where(eq(wikiSvgAssets.attachmentId, attachmentId))
      .get();
    if (asset) {
      const rendered = renderSvgAsset(asset.id);
      if (rendered) return `data:image/svg+xml;base64,${Buffer.from(rendered.svg).toString("base64")}`;
    }
  }
  const absolute = getAttachmentAbsolutePath(attachment.storedName);
  if (!fs.existsSync(absolute)) return null;
  return `data:${attachment.mimeType};base64,${fs.readFileSync(absolute).toString("base64")}`;
}

export async function renderStoredWikiDocument(pageId: string, typography: WikiTypographySettingsV1): Promise<{
  page: typeof wikiPages.$inferSelect;
  rendered: RenderedDocument;
}> {
  const page = db.select().from(wikiPages).where(eq(wikiPages.id, pageId)).get();
  if (!page || page.deletedAt) throw new Error("Page not found");
  const settings = localizeDocumentSettings(
    parseDocumentSettings(page.documentSettingsJson),
    page.citationLocale,
  );
  const doc = parseStoredDocument(page.contentJson);
  const references = formatBibliography(
    getCitationSourcesForPage(page.id, page.citationLocale, page.citationStyle),
    page.citationLocale,
    page.citationStyle,
  ).map((entry) => entry.text);
  const rendered = await renderDocumentHtml({
    title: page.title,
    doc,
    settings,
    typography,
    references,
    figureLabel: page.citationLocale.toLocaleLowerCase().startsWith("de") ? "Abbildung" : "Figure",
    tableLabel: page.citationLocale.toLocaleLowerCase().startsWith("de") ? "Tabelle" : "Table",
    resolveAsset: async ({ attachmentId, src }) => {
      const routeId = src.match(/^\/api\/files\/([^/?#]+)/)?.[1];
      const id = attachmentId || routeId || "";
      return id ? dataUriForAttachment(id, page.id) : src.startsWith("data:image/") ? src : null;
    },
  });
  return { page, rendered };
}

export async function generateWikiDocumentPdf(pageId: string, typography: WikiTypographySettingsV1) {
  const { page: storedPage, rendered } = await renderStoredWikiDocument(pageId, typography);
  const settings = localizeDocumentSettings(
    parseDocumentSettings(storedPage.documentSettingsJson),
    storedPage.citationLocale,
  );
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
