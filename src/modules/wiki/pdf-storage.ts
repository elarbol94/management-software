import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { attachments, wikiPdfDocuments, wikiSources } from "@/db/schema";
import { UPLOADS_PATH } from "@/lib/files";
import { sourceTitleFromFileName } from "./lib/pdf-evidence";
import { openPdfDocument } from "./lib/pdf-node";
import { PdfUploadStreamError, writePdfUploadToFile } from "./lib/pdf-upload-stream";

const DEFAULT_MAX_PDF_BYTES = 100 * 1024 * 1024;

export function maxPdfUploadBytes() {
  const configured = Number(process.env.MAX_PDF_UPLOAD_BYTES);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_MAX_PDF_BYTES;
}

function safeFileName(value: string) {
  const leaf = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240);
  return leaf.toLocaleLowerCase().endsWith(".pdf") ? leaf : `${leaf || "document"}.pdf`;
}

type ExistingPdf = { documentId: string; sourceId: string; status: string };

function findExistingPdf(sha256: string) {
  return sqlite.prepare(`
    SELECT d.id AS documentId, d.source_id AS sourceId, d.status AS status
    FROM attachments a
    JOIN wiki_pdf_documents d ON d.attachment_id = a.id
    JOIN wiki_sources s ON s.id = d.source_id
    WHERE a.sha256 = ? AND a.mime_type = 'application/pdf' AND s.deleted_at IS NULL
    LIMIT 1
  `).get(sha256) as ExistingPdf | undefined;
}

export async function ingestPdfStream(input: {
  stream: ReadableStream<Uint8Array>;
  fileName: string;
  sourceId?: string;
  userId: string;
}) {
  const fileName = safeFileName(input.fileName);
  const temporaryDirectory = path.join(UPLOADS_PATH, ".tmp");
  await fs.mkdir(temporaryDirectory, { recursive: true });
  const temporaryPath = path.join(temporaryDirectory, `${crypto.randomUUID()}.part`);
  const upload = await writePdfUploadToFile(input.stream, temporaryPath, maxPdfUploadBytes());
  try {
    const pdf = await openPdfDocument(temporaryPath);
    try {
      if (!Number.isInteger(pdf.document.numPages) || pdf.document.numPages < 1) {
        throw new Error("No readable pages");
      }
    } finally {
      await pdf.close();
    }
  } catch {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw new PdfUploadStreamError("The PDF is password-protected or structurally invalid");
  }

  const duplicate = findExistingPdf(upload.sha256);
  if (duplicate) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    return { ...duplicate, duplicate: true as const };
  }

  if (input.sourceId) {
    const source = db.select({ id: wikiSources.id }).from(wikiSources)
      .where(and(eq(wikiSources.id, input.sourceId), isNull(wikiSources.deletedAt))).get();
    if (!source) {
      await fs.unlink(temporaryPath).catch(() => undefined);
      throw new Error("Source not found");
    }
  }

  const storedName = `${upload.sha256.slice(0, 2)}/${crypto.randomUUID()}.pdf`;
  const absolutePath = path.join(UPLOADS_PATH, storedName);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.rename(temporaryPath, absolutePath);

  try {
    return db.transaction(() => {
      let sourceId = input.sourceId;
      if (!sourceId) {
        const title = sourceTitleFromFileName(fileName);
        sourceId = db.insert(wikiSources).values({
          type: "document",
          title,
          createdBy: input.userId,
          updatedBy: input.userId,
        }).returning({ id: wikiSources.id }).get().id;
        sqlite.prepare(`
          INSERT INTO wiki_sources_fts (source_id, title, contributors, metadata, abstract, notes)
          VALUES (?, ?, '', 'document', '', '')
        `).run(sourceId, title);
      }

      const countRow = sqlite.prepare(
        "SELECT count(*) AS count FROM wiki_pdf_documents WHERE source_id = ?",
      ).get(sourceId) as { count: number };
      const attachment = db.insert(attachments).values({
        fileName,
        storedName,
        mimeType: "application/pdf",
        sizeBytes: upload.sizeBytes,
        sha256: upload.sha256,
        entityType: "wikiSource",
        entityId: sourceId,
        uploadedBy: input.userId,
      }).returning({ id: attachments.id }).get();
      const document = db.insert(wikiPdfDocuments).values({
        sourceId,
        attachmentId: attachment.id,
        role: countRow.count === 0 ? "primary" : "supplementary",
        version: countRow.count + 1,
        metadataJson: JSON.stringify({ suggestedTitle: sourceTitleFromFileName(fileName) }),
        createdBy: input.userId,
      }).returning({ id: wikiPdfDocuments.id, status: wikiPdfDocuments.status }).get();

      return {
        sourceId,
        documentId: document.id,
        status: document.status,
        duplicate: false as const,
      };
    });
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => undefined);
    const duplicateAfterRace = findExistingPdf(upload.sha256);
    if (duplicateAfterRace) return { ...duplicateAfterRace, duplicate: true as const };
    throw error;
  }
}
