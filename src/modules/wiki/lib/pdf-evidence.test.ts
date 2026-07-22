import { describe, expect, it } from "vitest";
import {
  chooseExtractionMethod,
  hasPdfSignature,
  isEvidenceTargetType,
  normalizePdfRect,
  sourceTitleFromFileName,
} from "./pdf-evidence";

describe("PDF evidence contracts", () => {
  it("accepts only payloads with a PDF file signature", () => {
    expect(hasPdfSignature(Buffer.from("%PDF-1.7\n"))).toBe(true);
    expect(hasPdfSignature(Buffer.from("not a pdf"))).toBe(false);
    expect(hasPdfSignature(Buffer.from("%PDF"))).toBe(false);
  });

  it("creates a readable draft source title from a PDF filename", () => {
    expect(sourceTitleFromFileName("2026_research-evidence.final.pdf")).toBe(
      "2026 research evidence.final",
    );
    expect(sourceTitleFromFileName(".pdf")).toBe("Untitled PDF");
  });

  it("uses OCR only when a page has no meaningful native text", () => {
    expect(chooseExtractionMethod("A sufficiently long native paragraph.")).toBe("native");
    expect(chooseExtractionMethod("  12 ")).toBe("ocr");
    expect(chooseExtractionMethod("", false)).toBe("empty");
  });

  it("normalizes and clamps annotation rectangles to a PDF page", () => {
    expect(normalizePdfRect({ x: 100, y: -10, width: 250, height: 310 }, 200, 300)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
  });

  it("accepts only application entities that can carry evidence", () => {
    expect(isEvidenceTargetType("wikiPage")).toBe(true);
    expect(isEvidenceTargetType("fundingBookingAllocation")).toBe(true);
    expect(isEvidenceTargetType("customer")).toBe(false);
  });
});
