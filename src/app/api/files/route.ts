import { db } from "@/db";
import { wikiFigureRevisions } from "@/db/schema";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { presentationRole } from "@/modules/wiki/presentation-access";
import {
  isAttachmentEntityType,
  listAttachmentsFor,
  saveAttachment,
  UploadError,
} from "@/lib/files";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType") ?? "";
  const entityId = url.searchParams.get("entityId") ?? "";
  if (!isAttachmentEntityType(entityType) || !entityId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (entityType === "wikiPresentation" && !presentationRole(entityId, session.user)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const immutable = entityType === "wikiPage" ? new Set(db.select({ id: wikiFigureRevisions.attachmentId }).from(wikiFigureRevisions).all().map((row) => row.id)) : new Set<string>();
  return NextResponse.json(listAttachmentsFor(entityType, entityId).filter((file) => !immutable.has(file.id)));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const entityType = formData.get("entityType");
  const entityId = formData.get("entityId");

  if (
    !(file instanceof File) ||
    typeof entityType !== "string" ||
    typeof entityId !== "string" ||
    !isAttachmentEntityType(entityType) ||
    !entityId
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    if (entityType === "wikiPresentation") {
      const role = presentationRole(entityId, session.user);
      if (role !== "edit" && role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (entityType === "wikiPresentationLibrary") return NextResponse.json({ error: "Use the design library" }, { status: 403 });
    const attachment = await saveAttachment({
      file,
      entityType,
      entityId,
      userId: session.user.id,
    });
    revalidatePath("/documents");
    return NextResponse.json(attachment);
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
