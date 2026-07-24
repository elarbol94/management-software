import "server-only";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { wikiPdfDocuments, wikiPdfPages } from "@/db/schema";
import { getAttachmentAbsolutePath, UPLOADS_PATH } from "@/lib/files";
import { chooseExtractionMethod, extractPdfMetadataSuggestions } from "./lib/pdf-evidence";

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

function metadataValue(output: string, key: string) {
  return output.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"))?.[1]?.trim() ?? "";
}

function parsePageSize(output: string) {
  const match = output.match(/(?:Page(?:\s+\d+)? size):\s*([\d.]+)\s+x\s+([\d.]+)\s+pts/i);
  return { width: Number(match?.[1] ?? 0), height: Number(match?.[2] ?? 0) };
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
    await runCommand("pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-scale-to-x", "220", "-scale-to-y", "-1", "-jpeg", filePath, prefix]);
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
  await runCommand("pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-r", "150", "-png", filePath, prefix]);
  const tsv = await runCommand(process.env.TESSERACT_PATH || "tesseract", [`${prefix}.png`, "stdout", "-l", process.env.PDF_OCR_LANGUAGES || "deu+eng", "tsv"], 180_000);
  return parseOcrTsv(tsv);
}

async function processClaimedJob(job: PdfJob) {
  const startedAt = Date.now();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-evidence-"));
  const filePath = getAttachmentAbsolutePath(job.storedName);
  try {
    const info = await runCommand("pdfinfo", [filePath]);
    const pageCount = Number(metadataValue(info, "Pages"));
    if (!Number.isInteger(pageCount) || pageCount <= 0) throw new Error("The PDF has no readable pages");
    db.update(wikiPdfDocuments).set({ pageCount, progressPage: 0, updatedAt: new Date() })
      .where(eq(wikiPdfDocuments.id, job.id)).run();

    const firstPageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const nativeText = await runCommand("pdftotext", ["-f", String(pageNumber), "-l", String(pageNumber), "-layout", filePath, "-"]);
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
      const pageInfo = await runCommand("pdfinfo", ["-f", String(pageNumber), "-l", String(pageNumber), filePath]);
      const size = parsePageSize(pageInfo);

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

    db.update(wikiPdfDocuments).set({
      status: "ready",
      progressPage: pageCount,
      metadataJson: JSON.stringify(extractPdfMetadataSuggestions(info, firstPageTexts.join("\n"), job.metadataJson)),
      lockedAt: null,
      nextAttemptAt: null,
      processedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(wikiPdfDocuments.id, job.id)).run();
    console.info(JSON.stringify({ event: "pdf_processed", documentId: job.id, pageCount, durationMs: Date.now() - startedAt }));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
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
