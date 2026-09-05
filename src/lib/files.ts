import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { attachments, attachmentEntityTypes } from "@/db/schema";
import { isSafeInlineSvg } from "@/lib/svg-upload";

export const UPLOADS_PATH =
  process.env.UPLOADS_PATH ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data", "uploads");

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
// Caps gunzip's output so a small, highly-compressed .svgz cannot force an unbounded allocation (decompression bomb).
const MAX_SVG_DECOMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
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

  const ext = file.type === "image/svg+xml" && /\.svgz$/i.test(file.name)
    ? ".svgz"
    : ALLOWED_MIME[file.type];
  if (!ext) throw new UploadError(`File type not allowed: ${file.type}`);
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("File exceeds the 50 MB limit");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Media is served inline: reject disguised HTML and unsupported containers.
  if (/^(audio|video)\//.test(file.type)) {
    const header = buffer.subarray(0, 16);
    const valid = file.type.endsWith("mp4") ? header.subarray(4, 8).toString() === "ftyp"
      : file.type === "video/webm" ? header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : file.type === "audio/ogg" ? header.subarray(0, 4).toString() === "OggS"
      : file.type === "audio/wav" ? header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WAVE"
      : file.type === "audio/mpeg" ? header.subarray(0, 3).toString() === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) : false;
    if (!valid) throw new UploadError("The media content does not match its file type");
  }
  if (file.type === "image/svg+xml") {
    let svgBytes: Uint8Array = buffer;
    try {
      if (ext === ".svgz" || (buffer[0] === 0x1f && buffer[1] === 0x8b)) svgBytes = gunzipSync(buffer, { maxOutputLength: MAX_SVG_DECOMPRESSED_BYTES });
    } catch {
      throw new UploadError("SVGZ could not be decompressed, or exceeds the size limit once unpacked");
    }
    if (!isSafeInlineSvg(svgBytes)) throw new UploadError("SVG contains active or externally loaded content");
  }
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
