import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PdfUploadStreamError, writePdfUploadToFile } from "./pdf-upload-stream";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("streaming PDF uploads", () => {
  it("writes a valid PDF stream and returns its size and digest", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-upload-test-"));
    created.push(directory);
    const destination = path.join(directory, "upload.pdf");
    const bytes = new TextEncoder().encode("%PDF-1.7\nresearch evidence");

    const result = await writePdfUploadToFile(new Blob([bytes]).stream(), destination, 1024);

    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await fs.readFile(destination)).toEqual(Buffer.from(bytes));
  });

  it("rejects a spoofed PDF and removes the partial file", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-upload-test-"));
    created.push(directory);
    const destination = path.join(directory, "spoofed.pdf");

    await expect(
      writePdfUploadToFile(new Blob(["not a pdf"]).stream(), destination, 1024),
    ).rejects.toBeInstanceOf(PdfUploadStreamError);
    await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
