import { PDFDocument } from "pdf-lib";
import type { DocumentSettingsV1 } from "./document-settings";
import type { RenderedDocument } from "./document-renderer";

type PdfMetadata = {
  title: string;
  author?: string;
  subject?: string;
  keywords?: string;
};

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
    parts.push(await page.pdf({
      ...pdfOptions,
      displayHeaderFooter: input.settings.header.enabled || input.settings.footer.enabled,
      headerTemplate: input.rendered.headerTemplate,
      footerTemplate: input.rendered.footerTemplate,
    }));

    const merged = await PDFDocument.create();
    for (const bytes of parts) {
      const part = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(part, part.getPageIndices());
      for (const copied of pages) merged.addPage(copied);
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

