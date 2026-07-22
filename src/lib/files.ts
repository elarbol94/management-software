import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { attachments, attachmentEntityTypes } from "@/db/schema";

export const UPLOADS_PATH =
  process.env.UPLOADS_PATH ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data", "uploads");

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "text/tab-separated-values": ".tsv",
};

export type AttachmentEntityType = (typeof attachmentEntityTypes)[number];

export function isAttachmentEntityType(
  value: string,
): value is AttachmentEntityType {
  return (attachmentEntityTypes as readonly string[]).includes(value);
}

export class UploadError extends Error {}

export async function saveAttachment(options: {
  file: File;
  entityType: AttachmentEntityType;
  entityId: string;
  userId: string;
}) {
  const { file, entityType, entityId, userId } = options;

  const ext = ALLOWED_MIME[file.type];
  if (!ext) throw new UploadError(`File type not allowed: ${file.type}`);
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("File exceeds the 50 MB limit");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  // Shard by hash prefix so a single directory never grows unbounded.
  const storedName = `${sha256.slice(0, 2)}/${crypto.randomUUID()}${ext}`;

  const absolute = path.join(/* turbopackIgnore: true */ UPLOADS_PATH, storedName);
  fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(absolute), { recursive: true });
  fs.writeFileSync(/* turbopackIgnore: true */ absolute, buffer);

  const row = db
    .insert(attachments)
    .values({
      fileName: file.name,
      storedName,
      mimeType: file.type,
      sizeBytes: file.size,
      sha256,
      entityType,
      entityId,
      uploadedBy: userId,
    })
    .returning()
    .get();

  return row;
}

export function getAttachment(id: string) {
  return db.select().from(attachments).where(eq(attachments.id, id)).get();
}

export function getAttachmentAbsolutePath(storedName: string) {
  return path.join(/* turbopackIgnore: true */ UPLOADS_PATH, storedName);
}

export function listAttachmentsFor(
  entityType: AttachmentEntityType,
  entityId: string,
) {
  return db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.entityType, entityType),
        eq(attachments.entityId, entityId),
      ),
    )
    .all();
}

export function deleteAttachment(id: string) {
  const row = getAttachment(id);
  if (!row) return;
  db.delete(attachments).where(eq(attachments.id, id)).run();
  const absolute = getAttachmentAbsolutePath(row.storedName);
  if (fs.existsSync(/* turbopackIgnore: true */ absolute)) fs.unlinkSync(/* turbopackIgnore: true */ absolute);
}

/** Removes all attachments (rows + files) for an entity, e.g. when it is deleted. */
export function deleteAttachmentsFor(
  entityType: AttachmentEntityType,
  entityId: string,
) {
  for (const row of listAttachmentsFor(entityType, entityId)) {
    deleteAttachment(row.id);
  }
}
