import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { PdfUploadStreamError } from "@/modules/wiki/lib/pdf-upload-stream";
import { ingestPdfStream } from "@/modules/wiki/pdf-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!request.body) return NextResponse.json({ error: "Missing PDF body" }, { status: 400 });

  const url = new URL(request.url);
  const sourceId = url.searchParams.get("sourceId") || undefined;
  let fileName = request.headers.get("x-file-name") || "document.pdf";
  try { fileName = decodeURIComponent(fileName); } catch { /* retain the safe raw value */ }

  try {
    const result = await ingestPdfStream({
      stream: request.body,
      fileName,
      sourceId,
      userId: session.user.id,
    });
    revalidatePath("/wiki", "layout");
    revalidatePath(`/wiki/sources/${result.sourceId}`);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof PdfUploadStreamError) {
      const status = error.message.includes("limit") ? 413 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof Error && error.message === "Source not found") {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
