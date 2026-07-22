const PDF_SIGNATURE = "%PDF-";

export const evidenceTargetTypes = [
  "wikiPage",
  "project",
  "task",
  "accountingEntry",
  "invoice",
  "fundingProject",
  "fundingBudgetItem",
  "fundingBookingAllocation",
] as const;

export type EvidenceTargetType = (typeof evidenceTargetTypes)[number];
export type PdfExtractionMethod = "native" | "ocr" | "empty";
export type PdfRect = { x: number; y: number; width: number; height: number };

export function isEvidenceTargetType(value: string): value is EvidenceTargetType {
  return (evidenceTargetTypes as readonly string[]).includes(value);
}

export function hasPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_SIGNATURE.length) return false;
  return String.fromCharCode(...bytes.slice(0, PDF_SIGNATURE.length)) === PDF_SIGNATURE;
}

export function sourceTitleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.pdf$/i, "");
  const title = withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return title || "Untitled PDF";
}

export function chooseExtractionMethod(
  nativeText: string,
  ocrAvailable = true,
): PdfExtractionMethod {
  const meaningfulCharacters = nativeText.replace(/[^\p{L}\p{N}]/gu, "").length;
  if (meaningfulCharacters >= 20) return "native";
  return ocrAvailable ? "ocr" : "empty";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizePdfRect(rect: PdfRect, pageWidth: number, pageHeight: number): PdfRect {
  if (pageWidth <= 0 || pageHeight <= 0) throw new Error("Invalid PDF page dimensions");
  const x = clamp(rect.x / pageWidth, 0, 1);
  const y = clamp(rect.y / pageHeight, 0, 1);
  const right = clamp((rect.x + rect.width) / pageWidth, x, 1);
  const bottom = clamp((rect.y + rect.height) / pageHeight, y, 1);
  return { x, y, width: right - x, height: bottom - y };
}

export function pdfSourcePurgeBlocker(input: { activePageReferences: number; evidenceReferences: number }): "active-pages" | "evidence" | null {
  if (input.activePageReferences > 0) return "active-pages";
  if (input.evidenceReferences > 0) return "evidence";
  return null;
}

export function extractPdfMetadataSuggestions(info: string, firstPages: string, existingJson: string) {
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(existingJson) as Record<string, unknown>; } catch { /* ignore damaged suggestions */ }
  const value = (key: string) => info.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"))?.[1]?.trim() ?? "";
  const doi = firstPages.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i)?.[0]?.replace(/[.,;)]$/, "") ?? "";
  const isbn = firstPages.match(/\b(?:97[89][ -]?)?(?:\d[ -]?){9}[\dX]\b/i)?.[0]?.replace(/[ -]/g, "") ?? "";
  const year = value("CreationDate").match(/(?:19|20)\d{2}/)?.[0] ?? "";
  return {
    ...existing,
    suggestedTitle: value("Title") || existing.suggestedTitle || "",
    suggestedAuthor: value("Author"),
    suggestedIssuedDate: year,
    suggestedLanguage: value("Language"),
    suggestedDoi: doi,
    suggestedIsbn: isbn,
  };
}
