import fs from "node:fs";
import { Readable } from "node:stream";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiPages, wikiFigureRevisions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { presentationRole } from "@/modules/wiki/presentation-access";
import { parseByteRange } from "@/lib/http-range";
import {
  deleteAttachment,
  getAttachment,
  getAttachmentAbsolutePath,
} from "@/lib/files";
import { extractEmbeddedAttachmentIds, type TiptapNode } from "@/modules/wiki/lib/tiptap";

type Params = { params: Promise<{ id: string }> };

async function serveAttachment(request: Request, { params }: Params, headOnly = false) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const attachment = getAttachment(id);
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const absolute = getAttachmentAbsolutePath(attachment.storedName);
  if (attachment.entityType === "wikiPresentation" && !presentationRole(attachment.entityId, session.user)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(absolute); }
  catch { return NextResponse.json({ error: "File missing" }, { status: 404 }); }

  const rangeHeader = request.headers.get("range");
  const range = parseByteRange(rangeHeader, stat.size);
  if (rangeHeader && !range) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${stat.size}`, "Accept-Ranges": "bytes" },
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const length = Math.max(0, end - start + 1);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";
  const headers = new Headers({
    "Content-Type": attachment.mimeType,
    "Content-Length": String(length),
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    "Cache-Control": attachment.entityType === "wikiPresentation" ? "private, no-store" : "private, max-age=3600",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  if (attachment.mimeType === "image/svg+xml") {
    if (attachment.storedName.endsWith(".svgz")) headers.set("Content-Encoding", "gzip");
    headers.set("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  }
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);

  if (headOnly) return new NextResponse(null, { status: range ? 206 : 200, headers });
  const nodeStream = fs.createReadStream(absolute, { start, end });
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new NextResponse(body, { status: range ? 206 : 200, headers });
}

export async function GET(request: Request, context: Params) {
  return serveAttachment(request, context);
}

export async function HEAD(request: Request, context: Params) {
  return serveAttachment(request, context, true);
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const attachment = getAttachment(id);
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (attachment.entityType === "wikiPresentationLibrary") return NextResponse.json({ error: "Use the design library" }, { status: 403 });
  if (attachment.entityType === "wikiPresentation") {
    const role = presentationRole(attachment.entityId, session.user);
    if (role !== "edit" && role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (attachment.entityType === "wikiPage") {
    if (db.select({ id: wikiFigureRevisions.id }).from(wikiFigureRevisions).where(eq(wikiFigureRevisions.attachmentId, id)).get()) {
      return NextResponse.json({ error: "attachmentInUse" }, { status: 409 });
    }
    const page = db.select({ contentJson: wikiPages.contentJson }).from(wikiPages).where(eq(wikiPages.id, attachment.entityId)).get();
    if (page) {
      try {
        const document = JSON.parse(page.contentJson) as TiptapNode;
        if (extractEmbeddedAttachmentIds(document).includes(id)) {
          return NextResponse.json({ error: "attachmentInUse" }, { status: 409 });
        }
      } catch {
        // Invalid legacy documents do not contain a reliable attachment reference.
      }
    }
  }
  deleteAttachment(id);
  revalidatePath("/documents");
  revalidatePath("/wiki", "layout");
  return NextResponse.json({ ok: true });
}
