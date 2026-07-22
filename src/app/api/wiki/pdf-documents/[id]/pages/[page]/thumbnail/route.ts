import fs from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments, wikiPdfDocuments, wikiPdfPages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getAttachmentAbsolutePath } from "@/lib/files";
import { ensurePdfThumbnail } from "@/modules/wiki/pdf-processing";

export async function GET(_request: Request, context: { params: Promise<{ id: string; page: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, page } = await context.params;
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber <= 0) return NextResponse.json({ error: "Invalid page" }, { status: 400 });

  const row = db.select({
    thumbnailStoredName: wikiPdfPages.thumbnailStoredName,
    pdfStoredName: attachments.storedName,
  }).from(wikiPdfPages)
    .innerJoin(wikiPdfDocuments, eq(wikiPdfPages.documentId, wikiPdfDocuments.id))
    .innerJoin(attachments, eq(wikiPdfDocuments.attachmentId, attachments.id))
    .where(and(eq(wikiPdfPages.documentId, id), eq(wikiPdfPages.pageNumber, pageNumber))).get();
  if (!row) return NextResponse.json({ error: "PDF page not found" }, { status: 404 });

  try {
    const storedName = row.thumbnailStoredName || await ensurePdfThumbnail(
      getAttachmentAbsolutePath(row.pdfStoredName),
      id,
      pageNumber,
    );
    const data = await fs.readFile(getAttachmentAbsolutePath(storedName));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Thumbnail generation failed" }, { status: 500 });
  }
}
