import "server-only";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { wikiPdfDocuments, wikiPdfPages, wikiSourceContributors, wikiSources } from "@/db/schema";
import { getAttachmentAbsolutePath, UPLOADS_PATH } from "@/lib/files";
import { chooseExtractionMethod, extractPdfMetadataSuggestions } from "./lib/pdf-evidence";
import { openPdfDocument, pdfMetadataAsInfo } from "./lib/pdf-node";
import { fetchCrossrefWork } from "./lib/crossref";

type PdfJob = {
  id: string;
  sourceId: string;
  storedName: string;
  attempts: number;
  metadataJson: string;
};

type OcrWord = { text: string; x: number; y: number; width: number; height: number };

function runCommand(command: string, args: string[], timeout = 120_000) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error(`Required PDF tool \"${command}\" was not found. Install it or set ${command === "tesseract" ? "TESSERACT_PATH" : "PATH"}.`));
          return;
        }
        reject(new Error(String(stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseOcrTsv(tsv: string) {
  const rows = tsv.trim().split(/\r?\n/).slice(1).map((line) => line.split("\t"));
  const pageRow = rows.find((row) => row[0] === "1");
  const pageWidth = Math.max(1, Number(pageRow?.[6] ?? 1));
  const pageHeight = Math.max(1, Number(pageRow?.[7] ?? 1));
  const words: OcrWord[] = [];
  for (const row of rows) {
    if (row[0] !== "5") continue;
    const text = row.slice(11).join("\t").trim();
    if (!text) continue;
    words.push({
      text,
      x: Number(row[6]) / pageWidth,
      y: Number(row[7]) / pageHeight,
      width: Number(row[8]) / pageWidth,
      height: Number(row[9]) / pageHeight,
    });
  }
  return { words, text: words.map((word) => word.text).join(" ") };
}

function claimNextJob(): PdfJob | null {
  const now = Date.now();
  const stale = now - 15 * 60_000;
  const job = sqlite.prepare(`
    SELECT d.id, d.source_id AS sourceId, a.stored_name AS storedName,
           d.attempts, d.metadata_json AS metadataJson
    FROM wiki_pdf_documents d
    JOIN attachments a ON a.id = d.attachment_id
    WHERE d.attempts < 3 AND (
      d.status = 'queued'
      OR (d.status = 'failed' AND coalesce(d.next_attempt_at, 0) <= ?)
      OR (d.status IN ('extracting', 'ocr') AND coalesce(d.locked_at, 0) < ?)
    )
    ORDER BY d.created_at
    LIMIT 1
  `).get(now, stale) as PdfJob | undefined;
  if (!job) return null;
  db.update(wikiPdfDocuments).set({
    status: "extracting",
    lockedAt: new Date(now),
    attempts: job.attempts + 1,
    error: "",
    updatedAt: new Date(now),
  }).where(eq(wikiPdfDocuments.id, job.id)).run();
  return { ...job, attempts: job.attempts + 1 };
}

export async function ensurePdfThumbnail(filePath: string, documentId: string, pageNumber: number) {
  const storedName = "derived/" + documentId + "/page-" + pageNumber + ".jpg";
  const absolute = path.join(UPLOADS_PATH, storedName);
  try { await fs.access(absolute); return storedName; } catch { /* generate below */ }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-thumbnail-"));
  try {
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const prefix = path.join(temporary, "thumbnail");
    await runCommand(process.env.PDFTOPPM_PATH || "pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-scale-to-x", "220", "-scale-to-y", "-1", "-jpeg", filePath, prefix]);
    await fs.rename(prefix + ".jpg", absolute);
    db.update(wikiPdfPages).set({ thumbnailStoredName: storedName })
      .where(and(eq(wikiPdfPages.documentId, documentId), eq(wikiPdfPages.pageNumber, pageNumber))).run();
    return storedName;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function extractOcrPage(filePath: string, pageNumber: number, temporary: string) {
  const prefix = path.join(temporary, `ocr-${pageNumber}`);
  await runCommand(process.env.PDFTOPPM_PATH || "pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-r", "150", "-png", filePath, prefix]);
  const tsv = await runCommand(process.env.TESSERACT_PATH || "tesseract", [`${prefix}.png`, "stdout", "-l", process.env.PDF_OCR_LANGUAGES || "deu+eng", "tsv"], 180_000);
  return parseOcrTsv(tsv);
}

async function processClaimedJob(job: PdfJob) {
  const startedAt = Date.now();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-evidence-"));
  const filePath = getAttachmentAbsolutePath(job.storedName);
  let closePdf: (() => Promise<void>) | undefined;
  try {
    const pdf = await openPdfDocument(filePath);
    closePdf = pdf.close;
    const { document } = pdf;
    const info = await pdfMetadataAsInfo(document);
    const pageCount = document.numPages;
    if (!Number.isInteger(pageCount) || pageCount <= 0) throw new Error("The PDF has no readable pages");
    db.update(wikiPdfDocuments).set({ pageCount, progressPage: 0, updatedAt: new Date() })
      .where(eq(wikiPdfDocuments.id, job.id)).run();

    const firstPageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const nativeText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      const method = chooseExtractionMethod(nativeText, true);
      let text = nativeText.trim();
      let textLayer: OcrWord[] = [];
      if (method === "ocr") {
        db.update(wikiPdfDocuments).set({ status: "ocr", lockedAt: new Date() })
          .where(eq(wikiPdfDocuments.id, job.id)).run();
        const ocr = await extractOcrPage(filePath, pageNumber, temporary);
        text = ocr.text;
        textLayer = ocr.words;
      }
      if (pageNumber <= 2) firstPageTexts.push(text);
      const viewport = page.getViewport({ scale: 1 });
      const size = { width: viewport.width, height: viewport.height };

      db.transaction(() => {
        db.insert(wikiPdfPages).values({
          documentId: job.id,
          pageNumber,
          width: size.width,
          height: size.height,
          text,
          textLayerJson: JSON.stringify(textLayer),
          extractionMethod: method,
          thumbnailStoredName: "",
        }).onConflictDoUpdate({
          target: [wikiPdfPages.documentId, wikiPdfPages.pageNumber],
          set: { width: size.width, height: size.height, text, textLayerJson: JSON.stringify(textLayer), extractionMethod: method },
        }).run();
        sqlite.prepare("DELETE FROM wiki_pdf_pages_fts WHERE document_id = ? AND page_number = ?").run(job.id, pageNumber);
        sqlite.prepare("INSERT INTO wiki_pdf_pages_fts (document_id, page_number, source_id, text) VALUES (?, ?, ?, ?)")
          .run(job.id, pageNumber, job.sourceId, text);
        db.update(wikiPdfDocuments).set({ progressPage: pageNumber, lockedAt: new Date(), updatedAt: new Date() })
          .where(eq(wikiPdfDocuments.id, job.id)).run();
      });
    }

    const suggestions = extractPdfMetadataSuggestions(info, firstPageTexts.join("\n"), job.metadataJson);
    db.update(wikiPdfDocuments).set({
      status: "ready",
      progressPage: pageCount,
      metadataJson: JSON.stringify(suggestions),
      lockedAt: null,
      nextAttemptAt: null,
      processedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(wikiPdfDocuments.id, job.id)).run();
    if (suggestions.suggestedDoi) {
      // Enrichment is a bonus: Crossref being unreachable must not fail a processed PDF.
      await enrichSourceFromDoi(job.sourceId, suggestions.suggestedDoi).catch((error: unknown) => {
        console.warn(JSON.stringify({ event: "pdf_source_enrich_failed", sourceId: job.sourceId, reason: error instanceof Error ? error.message : "unknown" }));
      });
    }
    console.info(JSON.stringify({ event: "pdf_processed", documentId: job.id, pageCount, durationMs: Date.now() - startedAt }));
  } finally {
    await closePdf?.();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

/**
 * Fills in a source that was auto-created from a dropped PDF, using the DOI the
 * extractor found on its first pages. Only ever touches an untouched stub — a source
 * that still has no DOI, no contributors and no manual edit — so a record somebody
 * has already curated is never rewritten by a background job.
 */
async function enrichSourceFromDoi(sourceId: string, doi: string) {
  const source = db.select().from(wikiSources).where(eq(wikiSources.id, sourceId)).get();
  if (!source || source.deletedAt) return;
  if (source.doi || source.version > 1) return;
  const existingContributors = db
    .select({ id: wikiSourceContributors.id })
    .from(wikiSourceContributors)
    .where(eq(wikiSourceContributors.sourceId, sourceId))
    .all();
  if (existingContributors.length) return;

  const work = await fetchCrossrefWork(doi);
  if (!work.title) return;

  db.transaction(() => {
    // Empty columns only: the filename-derived title is the one value worth replacing.
    const keep = (current: string, next: string) => (current.trim() ? current : next);
    db.update(wikiSources).set({
      type: work.type,
      title: work.title,
      subtitle: keep(source.subtitle, work.subtitle),
      issuedDate: keep(source.issuedDate, work.issuedDate),
      containerTitle: keep(source.containerTitle, work.containerTitle),
      publisher: keep(source.publisher, work.publisher),
      volume: keep(source.volume, work.volume),
      issue: keep(source.issue, work.issue),
      pages: keep(source.pages, work.pages),
      doi: work.doi,
      url: keep(source.url, work.url),
      updatedAt: new Date(),
    }).where(eq(wikiSources.id, sourceId)).run();

    if (work.contributors.length) {
      db.insert(wikiSourceContributors).values(work.contributors.map((person, index) => ({
        sourceId,
        role: person.role,
        given: person.given,
        family: person.family,
        literal: person.literal,
        sortOrder: index,
      }))).run();
    }

    // wiki_sources_fts is maintained by hand, so the new title has to be reindexed here.
    const contributors = work.contributors
      .map((person) => person.literal || `${person.given} ${person.family}`.trim())
      .join(" ");
    const metadata = [work.type, work.issuedDate, work.containerTitle, work.publisher, work.doi, work.url].join(" ");
    sqlite.prepare("DELETE FROM wiki_sources_fts WHERE source_id = ?").run(sourceId);
    sqlite.prepare("INSERT INTO wiki_sources_fts (source_id, title, contributors, metadata, abstract, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sourceId, work.title, contributors, metadata, source.abstract, source.notes);
  });
  console.info(JSON.stringify({ event: "pdf_source_enriched", sourceId, doi: work.doi }));
}

let running = false;

export async function processNextPdf() {
  if (running) return false;
  const job = claimNextJob();
  if (!job) return false;
  running = true;
  try {
    await processClaimedJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2000) : "PDF processing failed";
    const retryMinutes = Math.min(30, 2 ** job.attempts);
    db.update(wikiPdfDocuments).set({
      status: "failed",
      error: message,
      lockedAt: null,
      nextAttemptAt: job.attempts < 3 ? new Date(Date.now() + retryMinutes * 60_000) : null,
      updatedAt: new Date(),
    }).where(eq(wikiPdfDocuments.id, job.id)).run();
    console.error(JSON.stringify({ event: "pdf_processing_failed", documentId: job.id, attempts: job.attempts, error: message }));
  } finally {
    running = false;
  }
  return true;
}

export function startPdfProcessingWorker() {
  const state = globalThis as typeof globalThis & { __pdfEvidenceWorker?: ReturnType<typeof setInterval> };
  if (state.__pdfEvidenceWorker) return;
  void processNextPdf();
  state.__pdfEvidenceWorker = setInterval(() => { void processNextPdf(); }, 2_500);
  state.__pdfEvidenceWorker.unref?.();
}

export function retryPdfDocument(documentId: string) {
  db.update(wikiPdfDocuments).set({ status: "queued", attempts: 0, error: "", nextAttemptAt: null, lockedAt: null, updatedAt: new Date() })
    .where(and(eq(wikiPdfDocuments.id, documentId), eq(wikiPdfDocuments.status, "failed"))).run();
}
