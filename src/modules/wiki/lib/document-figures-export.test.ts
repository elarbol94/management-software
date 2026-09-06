import { expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, PDFName, PDFDict, PDFArray } from "pdf-lib";
import { generateDocumentDocx } from "./document-docx";
import { renderDocumentHtml } from "./document-renderer";
import { appendPdfWithLinks, pdfFigurePages } from "./document-pdf-engine";
import { DEFAULT_DOCUMENT_SETTINGS } from "./document-settings";
import { docxHtmlToTiptap } from "./docx-import";
import type { TiptapNode } from "./tiptap";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>';
const doc: TiptapNode = { type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "See " }, { type: "crossReference", attrs: { targetId: "chart", label: "Old 99" } }] },
  { type: "commentableImage", attrs: { nodeId: "chart", numbered: true, caption: "Abbildung 8: Revenue", alt: "Revenue chart", wrap: "left", crop: { x: .1, y: .2, width: .7, height: .6 }, src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` } },
  { type: "figureList", attrs: { title: "Abbildungsverzeichnis" } },
] };
it("embeds original vector artwork, a fallback, crop metadata, reference fields and a figure-list field", async () => {
  const bytes = await generateDocumentDocx("Report", doc, DEFAULT_DOCUMENT_SETTINGS, { figureLabel: "Abbildung" }, () => ({ bytes: Buffer.from(svg), mimeType: "image/svg+xml", width: 100, height: 50 }));
  const files = unzipSync(bytes);
  const xml = strFromU8(files["word/document.xml"]);
  expect(Object.keys(files).filter((name) => name.startsWith("word/media/") && !name.endsWith("/"))).toHaveLength(2);
  expect(xml).toContain("SEQ Figure"); expect(xml).toContain("REF fig_chart"); expect(xml).toContain("PAGEREF fig_chart"); expect(xml).toContain('TOC \\c "Figure"');
  expect(xml).toContain('a:srcRect l="10000" t="20000" r="20000" b="20000"');
  expect(xml).toContain("w:framePr"); expect(xml).not.toContain("Old 99");
  expect(strFromU8(files["word/settings.xml"])).toContain("updateFields");
  expect(strFromU8(Object.entries(files).find(([name]) => name.endsWith(".svg"))![1])).toBe(svg);
});
it("uses stable targets, strips legacy numbers and does not append a duplicate list", async () => {
  const result = await renderDocumentHtml({ title: "Report", doc, settings: { ...DEFAULT_DOCUMENT_SETTINGS, figures: { ...DEFAULT_DOCUMENT_SETTINGS.figures, enabled: true } }, figureLabel: "Abbildung" });
  expect(result.bodyHtml).toContain('id="chart"'); expect(result.bodyHtml).toContain('href="#chart">Abbildung 1</a>');
  expect(result.bodyHtml.match(/class="figure-index"/g)).toHaveLength(1);
  expect(result.bodyHtml).toContain('data-figure-page="chart"');
  expect(result.bodyHtml).not.toContain("Abbildung 8");
});
it("imports embedded images without losing adjacent formatting or captions", () => {
  const imported = docxHtmlToTiptap('<p>Before <strong>bold<img src="/api/files/image123" alt="Chart"/>after</strong> text</p><p><img src="/api/files/image456"/></p><p class="figure-caption">Abbildung 9: Revenue</p>');
  expect(imported.content?.map((node) => node.type)).toEqual(["paragraph", "commentableImage", "paragraph", "commentableImage"]);
  expect(imported.content?.[1].attrs).toMatchObject({ attachmentId: "image123", alt: "Chart" });
  expect(imported.content?.[2].content?.[0]).toMatchObject({ text: "after", marks: [{ type: "bold" }] });
  expect(imported.content?.[3].attrs?.caption).toBe("Revenue");
  expect(JSON.stringify(docxHtmlToTiptap('<p><img src="file:///private.png"/></p>'))).not.toContain("private.png");
});
it("preserves named PDF destinations and direct links when adding a cover", async () => {
  const body = await PDFDocument.create(); const first = body.addPage(), target = body.addPage();
  body.catalog.set(PDFName.of("Dests"), body.context.obj({ chart: [target.ref, PDFName.of("XYZ"), 0, 500, 0] }));
  first.node.set(PDFName.of("Annots"), body.context.obj([body.context.register(body.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 100, 20], Dest: [target.ref, PDFName.of("XYZ"), 0, 500, 0] }))]));
  expect(pdfFigurePages(body)).toEqual({ chart: 2 });
  const merged = await PDFDocument.create(); merged.addPage(); await appendPdfWithLinks(merged, body);
  expect(pdfFigurePages(merged)).toEqual({ chart: 3 });
  const annotations = merged.getPage(1).node.lookup(PDFName.of("Annots")) as PDFArray;
  const annotation = merged.context.lookup(annotations.get(0)) as PDFDict;
  expect((annotation.lookup(PDFName.of("Dest")) as PDFArray).get(0)).toEqual(merged.getPage(2).ref);
});
