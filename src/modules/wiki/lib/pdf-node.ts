import "server-only";

import fs from "node:fs/promises";
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfWorkerGlobal = typeof globalThis & {
  pdfjsWorker?: { WorkerMessageHandler: unknown };
};

async function loadPdfJs() {
  // Next's standalone bundler cannot resolve PDF.js' runtime-relative fake
  // worker import. Register the bundled worker explicitly before getDocument
  // creates its first PDFWorker.
  const worker = (await import(
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  )) as { WorkerMessageHandler: unknown };
  const scope = globalThis as PdfWorkerGlobal;
  scope.pdfjsWorker ??= { WorkerMessageHandler: worker.WorkerMessageHandler };
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function openPdfDocument(filePath: string): Promise<{
  document: PDFDocumentProxy;
  close: () => Promise<void>;
}> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await fs.readFile(filePath)),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  return {
    document,
    close: () => loadingTask.destroy(),
  };
}

export async function pdfMetadataAsInfo(document: PDFDocumentProxy) {
  const metadata = await document.getMetadata();
  const info = metadata.info as Record<string, unknown>;
  return ["Title", "Author", "CreationDate", "Language"]
    .flatMap((key) => {
      const value = info[key];
      if (typeof value !== "string" || !value.trim()) return [];
      return `${key}: ${value.replace(/\s+/g, " ").trim()}`;
    })
    .join("\n");
}
