import fs from "node:fs";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteAttachment,
  getAttachment,
  getAttachmentAbsolutePath,
} from "@/lib/files";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const attachment = getAttachment(id);
  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const absolute = getAttachmentAbsolutePath(attachment.storedName);
  if (!fs.existsSync(absolute)) {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }

  const data = fs.readFileSync(absolute);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.sizeBytes),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  deleteAttachment(id);
  return NextResponse.json({ ok: true });
}
