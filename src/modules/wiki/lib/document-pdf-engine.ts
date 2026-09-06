import { PDFDocument, PDFArray, PDFDict, PDFName } from "pdf-lib";
import type { DocumentSettingsV1 } from "./document-settings";
import type { RenderedDocument } from "./document-renderer";

type PdfMetadata = {
  title: string;
  author?: string;
  subject?: string;
  keywords?: string;
};

export function pdfFigurePages(pdf: PDFDocument) {
  const destinations = pdf.catalog.lookup(PDFName.of("Dests"));
  const result: Record<string, number> = {};
  if (!(destinations instanceof PDFDict)) return result;
  const refs = pdf.getPages().map((page) => page.ref.toString());
  for (const [name, value] of destinations.entries()) {
    const destination = pdf.context.lookup(value);
    if (!(destination instanceof PDFArray)) continue;
    const page = refs.indexOf(destination.get(0).toString());
    if (page >= 0) result[name.decodeText()] = page + 1;
  }
  return result;
}

/** copyPages does not copy a source catalog's named destinations. Rebuild them against the new page refs. */
export async function appendPdfWithLinks(merged: PDFDocument, part: PDFDocument) {
  const originals = part.getPages();
  const copied = await merged.copyPages(part, part.getPageIndices());
  copied.forEach((page) => merged.addPage(page));
  const remap = (destination: PDFArray) => {
    const index = originals.findIndex((page) => page.ref.toString() === destination.get(0).toString());
    if (index < 0) return undefined;
    return merged.context.obj([copied[index].ref, ...destination.asArray().slice(1)]);
  };
  const names = part.catalog.lookup(PDFName.of("Dests"));
  if (names instanceof PDFDict) {
    let target = merged.catalog.lookup(PDFName.of("Dests"));
    if (!(target instanceof PDFDict)) { target = merged.context.obj({}); merged.catalog.set(PDFName.of("Dests"), target); }
    for (const [name, ref] of names.entries()) {
      const destination = part.context.lookup(ref);
      if (destination instanceof PDFArray) { const mapped = remap(destination); if (mapped) (target as PDFDict).set(name, mapped); }
    }
  }
  originals.forEach((page, index) => {
    const sourceAnnotations = page.node.lookup(PDFName.of("Annots"));
    const targetAnnotations = copied[index].node.lookup(PDFName.of("Annots"));
    if (!(sourceAnnotations instanceof PDFArray) || !(targetAnnotations instanceof PDFArray)) return;
    sourceAnnotations.asArray().forEach((ref, annotationIndex) => {
      const original = part.context.lookup(ref), clone = merged.context.lookup(targetAnnotations.get(annotationIndex));
      if (!(original instanceof PDFDict) || !(clone instanceof PDFDict)) return;
      const direct = original.lookup(PDFName.of("Dest"));
      if (direct instanceof PDFArray) { const mapped = remap(direct); if (mapped) clone.set(PDFName.of("Dest"), mapped); }
      const action = original.lookup(PDFName.of("A")), clonedAction = clone.lookup(PDFName.of("A"));
      if (action instanceof PDFDict && clonedAction instanceof PDFDict) {
        const destination = action.lookup(PDFName.of("D"));
        if (destination instanceof PDFArray) { const mapped = remap(destination); if (mapped) clonedAction.set(PDFName.of("D"), mapped); }
      }
    });
  });
}

export async function renderDocumentPdfBytes(input: {
  rendered: RenderedDocument;
  settings: DocumentSettingsV1;
  metadata: PdfMetadata;
}) {
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`PDF renderer is unavailable. Install the Playwright Chromium browser and try again. ${reason}`);
  }

  try {
    const page = await browser.newPage();
    async function prepare(html: string) {
      await page.setContent(html, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const image of Array.from(document.images)) {
          if (!image.complete) await new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          });
        }
      });
    }

    const pdfOptions = {
      format: input.settings.page.size,
      landscape: input.settings.page.orientation === "landscape",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: `${input.settings.page.marginsMm.top}mm`,
        right: `${input.settings.page.marginsMm.right}mm`,
        bottom: `${input.settings.page.marginsMm.bottom}mm`,
        left: `${input.settings.page.marginsMm.left}mm`,
      },
      tagged: false,
      outline: true,
    } as const;

    const parts: Uint8Array[] = [];
    if (input.rendered.coverDocumentHtml) {
      await prepare(input.rendered.coverDocumentHtml);
      parts.push(await page.pdf({
        ...pdfOptions,
        displayHeaderFooter: false,
      }));
    }
    await prepare(input.rendered.bodyDocumentHtml);
    const bodyOptions = {
      ...pdfOptions,
      displayHeaderFooter: input.settings.header.enabled || input.settings.footer.enabled,
      headerTemplate: input.rendered.headerTemplate,
      footerTemplate: input.rendered.footerTemplate,
    };
    let bodyBytes = await page.pdf(bodyOptions);
    let pages = pdfFigurePages(await PDFDocument.load(bodyBytes));
    const hasFigurePages = await page.locator("[data-figure-page]").count();
    if (hasFigurePages) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await page.evaluate(({ pages, start }) => {
          document.querySelectorAll<HTMLElement>("[data-figure-page]").forEach((element) => {
            const page = pages[element.dataset.figurePage || ""];
            element.textContent = page ? String(page + start - 1) : "—";
          });
        }, { pages, start: input.settings.footer.pageNumberStart });
        bodyBytes = await page.pdf(bodyOptions);
        const next = pdfFigurePages(await PDFDocument.load(bodyBytes));
        if (JSON.stringify(next) === JSON.stringify(pages)) break;
        if (attempt === 4) throw new Error("Figure-list pagination did not stabilize");
        pages = next;
      }
    }
    parts.push(bodyBytes);

    const merged = await PDFDocument.create();
    for (const bytes of parts) {
      const part = await PDFDocument.load(bytes);
      await appendPdfWithLinks(merged, part);
    }
    merged.setTitle(input.metadata.title);
    if (input.metadata.author) merged.setAuthor(input.metadata.author);
    if (input.metadata.subject) merged.setSubject(input.metadata.subject);
    if (input.metadata.keywords) {
      merged.setKeywords(input.metadata.keywords.split(",").map((keyword) => keyword.trim()).filter(Boolean));
    }
    merged.setProducer("Management Platform document renderer");
    merged.setCreator("Management Platform");
    return Buffer.from(await merged.save({ useObjectStreams: true }));
  } finally {
    await browser.close();
  }
}

