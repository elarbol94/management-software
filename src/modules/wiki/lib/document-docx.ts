import {
  Document, HeadingLevel, type IParagraphOptions, Packer, PageBreak, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType, ImageRun, Bookmark, SimpleField,
  InternalHyperlink, TableOfContents, type ParagraphChild, type IFrameOptions,
} from "docx";
import sharp from "sharp";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { TiptapNode } from "./tiptap";
import type { DocumentSettingsV1 } from "./document-settings";
import type { DocumentImageResolver } from "./document-image";
import { collectAnnexes, collectHeadings, collectTables } from "./document-renderer";
import { resolveCrossReferenceLabels } from "./figure-caption";
import { documentFigures, figureCrop, figureWidth, hasFigureList, isFigure, stripFigureNumber, type FigureCrop } from "./figure";

const bookmark = (id: string) => `fig_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`.slice(0, 40);
type Block = Paragraph | Table | TableOfContents;
type Context = {
  labels: Map<string, string>; figures: ReturnType<typeof documentFigures>; figureLabel: string;
  images: DocumentImageResolver; settings: DocumentSettingsV1; crops: Map<string, FigureCrop>;
};
function runs(node: TiptapNode, context: Context): ParagraphChild[] {
  if (node.text !== undefined) {
    const marks = new Set((node.marks ?? []).map((mark) => mark.type));
    return [new TextRun({ text: node.text, bold: marks.has("bold"), italics: marks.has("italic"), strike: marks.has("strike"), subScript: marks.has("subscript"), superScript: marks.has("superscript") })];
  }
  if (node.type === "hardBreak") return [new TextRun({ break: 1 })];
  if (node.type === "crossReference") {
    const id = String(node.attrs?.targetId || "");
    const label = context.labels.get(id);
    return label ? [new SimpleField(`REF ${bookmark(id)} \\h`, label)] : [new TextRun(context.figureLabel === "Abbildung" ? "Verweisziel fehlt" : "Reference target missing")];
  }
  if (node.type === "documentVariable") return [new TextRun(context.settings.variables[String(node.attrs?.key)] || String(node.attrs?.label || ""))];
  if (node.type === "citation") return [new TextRun(String(node.attrs?.label || ""))];
  return (node.content ?? []).flatMap((child) => runs(child, context));
}
function paragraph(node: TiptapNode, context: Context, options: IParagraphOptions = {}) {
  return new Paragraph({ ...options, children: runs(node, context) });
}
function figureList(title: string, context: Context, pageBreakBefore = false): Block[] {
  const rows = context.figures.filter((figure) => figure.included).map((figure) => new Paragraph({
    children: [new InternalHyperlink({ anchor: bookmark(figure.nodeId), children: [new TextRun(`${context.figureLabel} ${figure.number}: ${figure.caption}`)] }), new TextRun("\t"), new SimpleField(`PAGEREF ${bookmark(figure.nodeId)} \\h`)],
    tabStops: [{ type: "right", position: 8500, leader: "dot" }],
  }));
  return [new Paragraph({ text: title, heading: HeadingLevel.HEADING_1, pageBreakBefore }), new TableOfContents(undefined, { captionLabelIncludingNumbers: "Figure", hyperlink: true, contentChildren: rows, beginDirty: true })];
}
async function figureBlock(node: TiptapNode, context: Context): Promise<Block[]> {
  const attrs = node.attrs || {};
  const id = String(attrs.nodeId || "");
  const figure = context.figures.find((item) => item.nodeId === id);
  const caption = stripFigureNumber(String(attrs.caption || ""));
  const image = context.images(id);
  const label: ParagraphChild[] = figure ? [new TextRun(`${context.figureLabel} `), new SimpleField("SEQ Figure \\* ARABIC", String(figure.number))] : [];
  const captionRuns: ParagraphChild[] = [new Bookmark({ id: bookmark(id), children: label.length ? label : [new TextRun(caption)] }), ...(label.length ? [new TextRun(`: ${caption}`)] : [])];
  if (!image) return [new Paragraph({ children: [new TextRun(context.figureLabel === "Abbildung" ? "Bild nicht verfügbar" : "Image unavailable")] }), new Paragraph({ children: captionRuns })];
  const crop = figureCrop(attrs.crop);
  context.crops.set(id, crop);
  const landscape = context.settings.page.orientation === "landscape";
  const pageWidth = context.settings.page.size === "A4" ? 210 : 215.9;
  const pageHeight = context.settings.page.size === "A4" ? 297 : 279.4;
  const margins = context.settings.page.marginsMm;
  const usableWidth = ((landscape ? pageHeight : pageWidth) - margins.left - margins.right) * 96 / 25.4;
  const usableHeight = ((landscape ? pageWidth : pageHeight) - margins.top - margins.bottom - 16) * 96 / 25.4;
  const ratio = image.width * crop.width / (image.height * crop.height);
  const width = Math.min(usableWidth * figureWidth(attrs.widthPercent) / 100, usableHeight * ratio);
  const height = width / ratio;
  const transformation = { width, height };
  const data = Buffer.from(image.bytes);
  const png = image.mimeType === "image/webp" || image.mimeType === "image/svg+xml" ? await sharp(data, { limitInputPixels: 40_000_000 }).png().toBuffer() : undefined;
  const imageRun = image.mimeType === "image/svg+xml"
    ? new ImageRun({ type: "svg", data, fallback: { type: "png", data: png! }, transformation, altText: { name: `figure:${id}`, description: String(attrs.alt || ""), title: caption } })
    : new ImageRun({ type: image.mimeType === "image/jpeg" ? "jpg" : "png", data: png || data, transformation, altText: { name: `figure:${id}`, description: String(attrs.alt || ""), title: caption } });
  const alignment = attrs.alignment === "left" || attrs.alignment === "right" ? attrs.alignment : "center";
  const wrap = attrs.wrap === "left" || attrs.wrap === "right" ? attrs.wrap : null;
  // Identical frame properties on adjacent image/caption paragraphs keep them in one anchored frame.
  const frame: IFrameOptions | undefined = wrap ? { type: "alignment", alignment: { x: wrap, y: "top" }, anchor: { horizontal: "margin", vertical: "text" }, width: Math.round(width * 15), height: 0, rule: "auto", wrap: "around", space: { horizontal: 180, vertical: 120 } } : undefined;
  const blocks: Block[] = [new Paragraph({ children: [imageRun], alignment, keepNext: Boolean(figure || caption), keepLines: true, frame })];
  if (figure || caption) blocks.push(new Paragraph({ children: captionRuns, style: "Caption", keepLines: true, frame, alignment }));
  return blocks;
}
async function block(node: TiptapNode, context: Context): Promise<Block[]> {
  if (isFigure(node.type)) return figureBlock(node, context);
  if (node.type === "figureList") return figureList(String(node.attrs?.title || context.settings.figures.heading), context, node.attrs?.pageBreakBefore === true);
  if (node.type === "figureListEntry") return [];
  if (node.type === "heading" || node.type === "annexMarker") {
    const id = String(node.attrs?.id || node.attrs?.annexId || "");
    const children = node.type === "annexMarker" ? [new TextRun(String(node.attrs?.title || "Annex"))] : runs(node, context);
    return [new Paragraph({ heading: Number(node.attrs?.level) === 1 ? HeadingLevel.HEADING_1 : Number(node.attrs?.level) === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2, children: id ? [new Bookmark({ id: bookmark(id), children })] : children })];
  }
  if (node.type === "paragraph") return [paragraph(node, context)];
  if (node.type === "blockquote") return [paragraph(node, context, { indent: { left: 420 } })];
  if (node.type === "bulletList" || node.type === "orderedList") {
    const result: Block[] = [];
    for (const item of node.content || []) {
      for (const [index, child] of (item.content || []).entries()) {
        if (index === 0 && child.type === "paragraph") result.push(paragraph(child, context, node.type === "bulletList" ? { bullet: { level: 0 } } : { numbering: { reference: "proposal-numbering", level: 0 } }));
        else result.push(...await block(child, context));
      }
    }
    return result;
  }
  if (node.type === "markdownTable") {
    const rows: TableRow[] = [];
    for (const row of node.content || []) {
      const cells: TableCell[] = [];
      for (const cell of row.content || []) {
        const children = (await Promise.all((cell.content || []).map((child) => block(child, context)))).flat().filter((entry): entry is Paragraph | Table => !(entry instanceof TableOfContents));
        cells.push(new TableCell({ children: children.length ? children : [new Paragraph("")] }));
      }
      rows.push(new TableRow({ children: cells }));
    }
    const table = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
    const id = String(node.attrs?.tableId || "");
    const caption = String(node.attrs?.caption || "");
    return caption ? [new Paragraph({ children: [new Bookmark({ id: bookmark(id), children: [new TextRun(context.labels.get(id) || caption)] }), new TextRun(`: ${caption}`)], style: "Caption", keepNext: true }), table] : [table];
  }
  if (node.type === "pageBreak") return [new Paragraph({ children: [new PageBreak()] })];
  if (node.type === "signatureBlock") return [new Paragraph({ spacing: { before: 720 }, children: [new TextRun("____________________________")]}), new Paragraph({ text: String(node.attrs?.name || "") })];
  return (await Promise.all((node.content || []).map((child) => block(child, context)))).flat();
}

/** docx exposes the drawing but not DrawingML's source crop; add that standard element without altering source media. */
export function applyDocxFigureCrops(bytes: Uint8Array, crops: Map<string, FigureCrop>) {
  const files = unzipSync(bytes);
  const document = new DOMParser().parseFromString(strFromU8(files["word/document.xml"]), "application/xml");
  for (const drawing of Array.from(document.getElementsByTagName("w:drawing"))) {
    const properties = drawing.getElementsByTagName("wp:docPr")[0];
    const id = properties?.getAttribute("name")?.replace(/^figure:/, "");
    const crop = id ? crops.get(id) : undefined;
    if (!crop || (!crop.x && !crop.y && crop.width === 1 && crop.height === 1)) continue;
    const fill = drawing.getElementsByTagName("pic:blipFill")[0];
    if (!fill) continue;
    for (const existing of Array.from(fill.getElementsByTagName("a:srcRect"))) fill.removeChild(existing);
    const rect = document.createElementNS("http://schemas.openxmlformats.org/drawingml/2006/main", "a:srcRect");
    for (const [key, value] of Object.entries({ l: crop.x, t: crop.y, r: 1 - crop.x - crop.width, b: 1 - crop.y - crop.height })) rect.setAttribute(key, String(Math.round(value * 100000)));
    const stretch = fill.getElementsByTagName("a:stretch")[0];
    fill.insertBefore(rect, stretch || null);
  }
  files["word/document.xml"] = strToU8(new XMLSerializer().serializeToString(document));
  return Buffer.from(zipSync(files));
}
export async function generateDocumentDocx(title: string, doc: TiptapNode, settings: DocumentSettingsV1, labels: { figureLabel?: string; tableLabel?: string } = {}, images: DocumentImageResolver = () => undefined) {
  const figures = documentFigures(doc);
  const context: Context = { labels: resolveCrossReferenceLabels({ headings: collectHeadings(doc), annexes: collectAnnexes(doc), figures: figures.map((figure) => ({ id: figure.nodeId, caption: figure.caption })), tables: collectTables(doc).map((table) => ({ id: table.tableId, caption: table.caption })), figureLabel: labels.figureLabel || "Figure", tableLabel: labels.tableLabel || "Table" }), figures, figureLabel: labels.figureLabel || "Figure", images, settings, crops: new Map() };
  const content = (await Promise.all((doc.content || []).map((child) => block(child, context)))).flat();
  if (settings.figures.enabled && !hasFigureList(doc)) content.push(...figureList(settings.figures.heading, context, settings.figures.pageBreakBefore));
  const document = new Document({ creator: settings.metadata.author, title, subject: settings.metadata.subject, features: { updateFields: true },
    styles: { paragraphStyles: [{ id: "Caption", name: "Caption", basedOn: "Normal", run: { size: 20 }, paragraph: { spacing: { after: 120 } } }] },
    numbering: { config: [{ reference: "proposal-numbering", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "start" }] }] },
    sections: [{ properties: { page: { size: { width: Math.round((settings.page.size === "A4" ? 210 : 215.9) * 56.693), height: Math.round((settings.page.size === "A4" ? 297 : 279.4) * 56.693), orientation: settings.page.orientation }, margin: Object.fromEntries(Object.entries(settings.page.marginsMm).map(([key, value]) => [key, Math.round(value * 56.693)])) } }, children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE }), ...content] }],
  });
  return applyDocxFigureCrops(await Packer.toBuffer(document), context.crops);
}
