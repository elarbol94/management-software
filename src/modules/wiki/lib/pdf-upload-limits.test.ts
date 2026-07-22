import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PdfUploadStreamError, writePdfUploadToFile } from "./pdf-upload-stream";

describe("PDF streaming size limits", () => {
  it("stops an oversized stream and removes its partial file", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-limit-test-"));
    const destination = path.join(directory, "oversized.pdf");
    try {
      await expect(writePdfUploadToFile(
        new Blob(["%PDF-1.7\n", "x".repeat(200)]).stream(),
        destination,
        32,
      )).rejects.toBeInstanceOf(PdfUploadStreamError);
      await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
