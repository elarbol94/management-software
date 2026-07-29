import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { openPdfDocument } from "./pdf-node";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("openPdfDocument", () => {
  test("opens a valid native-text PDF", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "startup-pdf-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "native-text.pdf");

    const source = await PDFDocument.create();
    const page = source.addPage([612, 792]);
    const font = await source.embedFont(StandardFonts.Helvetica);
    page.drawText("Traceable PDF evidence", {
      x: 72,
      y: 720,
      size: 18,
      font,
    });
    await fs.writeFile(filePath, await source.save());

    const pdf = await openPdfDocument(filePath);
    try {
      expect(pdf.document.numPages).toBe(1);
      const text = await (await pdf.document.getPage(1)).getTextContent();
      expect(text.items.some((item) => "str" in item && item.str.includes("Traceable PDF evidence"))).toBe(true);
    } finally {
      await pdf.close();
    }
  }, 15_000);
});
