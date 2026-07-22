import crypto from "node:crypto";
import fs from "node:fs/promises";
import { hasPdfSignature } from "./pdf-evidence";

export class PdfUploadStreamError extends Error {}

export async function writePdfUploadToFile(
  stream: ReadableStream<Uint8Array>,
  destination: string,
  maxBytes: number,
): Promise<{ sizeBytes: number; sha256: string }> {
  const handle = await fs.open(destination, "wx");
  const hash = crypto.createHash("sha256");
  const reader = stream.getReader();
  const signature = new Uint8Array(5);
  let signatureBytes = 0;
  let sizeBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes) throw new PdfUploadStreamError("PDF exceeds the upload limit");
      if (signatureBytes < signature.byteLength) {
        const count = Math.min(signature.byteLength - signatureBytes, value.byteLength);
        signature.set(value.subarray(0, count), signatureBytes);
        signatureBytes += count;
      }
      hash.update(value);
      await handle.write(value);
    }
    if (!hasPdfSignature(signature.subarray(0, signatureBytes))) {
      throw new PdfUploadStreamError("The uploaded file is not a valid PDF");
    }
    await handle.sync();
    return { sizeBytes, sha256: hash.digest("hex") };
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    await handle.close().catch(() => undefined);
    await fs.unlink(destination).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
    await handle.close().catch(() => undefined);
  }
}
