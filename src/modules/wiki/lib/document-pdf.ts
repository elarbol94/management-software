import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiPages, wikiSvgAssets, wikiFigureAssets } from "@/db/schema";
import sharp from "sharp";
import { gunzipSync } from "node:zlib";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { figureRevisionBytes } from "../figure-assets";
import { isSafeInlineSvg } from "@/lib/svg-upload";
import { isFigure } from "./figure";
import type { TiptapNode } from "./tiptap";
import type { DocumentImage } from "./document-image";
import { applyDocumentTypography, type SvgDocument, type SvgElement } from "./svg-typography";
import { getAttachment, getAttachmentAbsolutePath } from "@/lib/files";
import { formatBibliography } from "./citations";
import { localizeDocumentSettings, parseDocumentSettings } from "./document-settings";
import { renderDocumentHtml, type RenderedDocument } from "./document-renderer";

import { parseDocumentForExport } from "./suggestions";
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
  let bytes = fs.readFileSync(absolute);
  if (attachment.mimeType === "image/svg+xml" && attachment.storedName.endsWith(".svgz")) bytes = gunzipSync(bytes, { maxOutputLength: 10 * 1024 * 1024 });
  return `data:${attachment.mimeType};base64,${bytes.toString("base64")}`;
}

export async function snapshotDocumentImages(pageId: string, input: TiptapNode, typography: WikiTypographySettingsV1, settings: ReturnType<typeof parseDocumentSettings>, revisions?: Record<string, number>) {
  const doc = structuredClone(input);
  const nodes: TiptapNode[] = [];
  const collect = (node: TiptapNode) => { if (isFigure(node.type)) nodes.push(node); node.content?.forEach(collect); };
  collect(doc);
  const pending = new Map<string, Promise<{ bytes: Uint8Array; mimeType: string }>>();
  for (const node of nodes) {
    const attrs = node.attrs ??= {};
    if (!attrs.nodeId) attrs.nodeId = `export-figure-${nodes.indexOf(node) + 1}`;
    const assetId = String(attrs.assetId || "");
    const attachmentId = String(attrs.attachmentId || String(attrs.src || "").match(/^\/api\/files\/([^/?#]+)/)?.[1] || "");
    const key = assetId || attachmentId || String(attrs.nodeId);
    if (pending.has(key)) continue;
    if (assetId) {
      const asset = db.select().from(wikiFigureAssets).where(eq(wikiFigureAssets.id, assetId)).get();
      if (revisions && !revisions[assetId]) throw new Error("Figure snapshot is out of date");
      if (asset?.pageId === pageId) pending.set(key, figureRevisionBytes(pageId, assetId, revisions?.[assetId] ?? asset.version));
    } else {
      const uri = attachmentId ? dataUriForAttachment(attachmentId, pageId) : String(attrs.src || "");
      if (node.type === "mermaidDiagram" && attrs.svg) pending.set(key, Promise.resolve({ bytes: Buffer.from(String(attrs.svg)), mimeType: "image/svg+xml" }));
      else {
        const match = uri?.match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/);
        if (match) pending.set(key, Promise.resolve({ bytes: Buffer.from(match[2], "base64"), mimeType: match[1] }));
      }
    }
  }
  const resolved = new Map<string, DocumentImage>();
  await Promise.all([...pending].map(async ([key, promise]) => {
    try {
      const original = await promise;
      const mimeType = original.mimeType;
      let bytes = original.bytes;
      if (mimeType === "image/svg+xml") {
        if (!isSafeInlineSvg(bytes)) return;
        const document = new DOMParser().parseFromString(Buffer.from(bytes).toString("utf8"), "image/svg+xml");
        const elements = [...Array.from(document.getElementsByTagName("text")), ...Array.from(document.getElementsByTagName("tspan"))];
        // Legacy SVGs were already rendered with their bindings and typography.
        if (!getAttachment(key)) applyDocumentTypography(document as unknown as SvgDocument, elements as unknown as SvgElement[], settings, null, typography);
        bytes = Buffer.from(new XMLSerializer().serializeToString(document));
      }
      const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
      if (metadata.width && metadata.height) resolved.set(key, { bytes, mimeType, width: metadata.width, height: metadata.height });
    } catch { /* Missing artwork is reported in the rendered document, without dropping its reference target. */ }
  }));
  const images = new Map<string, DocumentImage>();
  for (const node of nodes) {
    const attrs = node.attrs!;
    const key = String(attrs.assetId || attrs.attachmentId || String(attrs.src || "").match(/^\/api\/files\/([^/?#]+)/)?.[1] || attrs.nodeId);
    const image = resolved.get(key);
    if (image) { images.set(String(attrs.nodeId), image); attrs.aspectRatio = image.width / image.height; attrs.src = `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`; }
  }
  return { doc, images };
}

export async function renderStoredWikiDocument(pageId: string, typography: WikiTypographySettingsV1, revisions?: Record<string, number>): Promise<{
  page: typeof wikiPages.$inferSelect;
  rendered: RenderedDocument;
  doc: TiptapNode;
  images: Map<string, DocumentImage>;
}> {
  const page = db.select().from(wikiPages).where(eq(wikiPages.id, pageId)).get();
  if (!page || page.deletedAt) throw new Error("Page not found");
  const settings = localizeDocumentSettings(
    parseDocumentSettings(page.documentSettingsJson),
    page.citationLocale,
  );
  const { doc, images } = await snapshotDocumentImages(pageId, parseDocumentForExport(page.contentJson), typography, settings, revisions);
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
    resolveAsset: async ({ src }) => src.startsWith("data:image/") ? src : null,
  });
  return { page, rendered, doc, images };
}

export async function generateWikiDocumentPdf(pageId: string, typography: WikiTypographySettingsV1, revisions?: Record<string, number>) {
  const { page: storedPage, rendered } = await renderStoredWikiDocument(pageId, typography, revisions);
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
