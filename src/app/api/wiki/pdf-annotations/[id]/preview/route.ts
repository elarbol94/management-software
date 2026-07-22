import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { wikiPdfAnnotations } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getAttachmentAbsolutePath } from "@/lib/files";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const annotation = db.select({ storedName: wikiPdfAnnotations.previewStoredName }).from(wikiPdfAnnotations)
    .where(and(eq(wikiPdfAnnotations.id, id), isNull(wikiPdfAnnotations.deletedAt))).get();
  if (!annotation?.storedName) return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  try {
    const data = await fs.readFile(/* turbopackIgnore: true */ getAttachmentAbsolutePath(annotation.storedName));
    const mimeType = path.extname(annotation.storedName).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": mimeType, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Preview missing" }, { status: 404 });
  }
}
