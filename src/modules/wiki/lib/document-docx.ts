import {
  Document,
  HeadingLevel,
  type IParagraphOptions,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { TiptapNode } from "./tiptap";
import type { DocumentSettingsV1 } from "./document-settings";

function plainText(node: TiptapNode): string {
  if (node.text) return node.text;
  if (node.type === "documentVariable") return `{${String(node.attrs?.key ?? "")}}`;
  if (node.type === "citation") return String(node.attrs?.label ?? "");
  return (node.content ?? []).map(plainText).join("");
}

function runs(node: TiptapNode): TextRun[] {
  if (node.text !== undefined) {
    const marks = new Set((node.marks ?? []).map((mark) => mark.type));
    return [new TextRun({ text: node.text, bold: marks.has("bold"), italics: marks.has("italic"), strike: marks.has("strike"), subScript: marks.has("subscript"), superScript: marks.has("superscript") })];
  }
  if (["documentVariable", "citation", "crossReference"].includes(node.type ?? "")) return [new TextRun(plainText(node))];
  return (node.content ?? []).flatMap(runs);
}

function paragraph(node: TiptapNode, options: IParagraphOptions = {}) {
  return new Paragraph({ ...options, children: runs(node) });
}

function block(node: TiptapNode): Array<Paragraph | Table> {
  if (node.type === "heading") {
    const levels = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;
    return [paragraph(node, { heading: levels[Number(node.attrs?.level) as 1 | 2 | 3] ?? HeadingLevel.HEADING_2 })];
  }
  if (node.type === "paragraph") return [paragraph(node)];
  if (node.type === "blockquote") return [paragraph(node, { indent: { left: 420 } })];
  if (node.type === "bulletList" || node.type === "orderedList") {
    return (node.content ?? []).map((item) => paragraph(item, node.type === "bulletList" ? { bullet: { level: 0 } } : { numbering: { reference: "proposal-numbering", level: 0 } }));
  }
  if (node.type === "markdownTable") {
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: (node.content ?? []).map((row) => new TableRow({ children: (row.content ?? []).map((cell) => new TableCell({ children: [paragraph(cell)] })) })),
    });
    const caption = String(node.attrs?.caption ?? "").trim();
    return caption ? [new Paragraph({ text: caption, style: "Caption" }), table] : [table];
  }
  if (node.type === "pageBreak") return [new Paragraph({ children: [new PageBreak()] })];
  if (node.type === "annexMarker") return [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(String(node.attrs?.title ?? "Annex"))] })];
  if (node.type === "signatureBlock") {
    return [new Paragraph({ spacing: { before: 720 }, children: [new TextRun("____________________________")]}), new Paragraph({ children: [new TextRun({ text: String(node.attrs?.name ?? ""), bold: true })] }), new Paragraph({ text: [node.attrs?.role, node.attrs?.location, node.attrs?.date].filter(Boolean).join(" · ") })];
  }
  return (node.content ?? []).flatMap(block);
}

export async function generateDocumentDocx(title: string, doc: TiptapNode, settings: DocumentSettingsV1) {
  const content = (doc.content ?? []).flatMap(block);
  const document = new Document({
    creator: settings.metadata.author,
    title,
    subject: settings.metadata.subject,
    description: "Exported from the management platform wiki",
    numbering: { config: [{ reference: "proposal-numbering", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "start" }] }] },
    sections: [{
      properties: {
        page: {
          size: settings.page.orientation === "landscape" ? { orientation: "landscape" } : undefined,
          margin: Object.fromEntries(Object.entries(settings.page.marginsMm).map(([key, value]) => [key, Math.round(value * 56.7)])),
        },
      },
      children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE }), ...content],
    }],
  });
  return Packer.toBuffer(document);
}
