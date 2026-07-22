import { describe, expect, it } from "vitest";
import { extractPdfMetadataSuggestions } from "./pdf-evidence";

describe("PDF metadata suggestions", () => {
  it("combines PDF/XMP-style info with identifiers found in page text", () => {
    const result = extractPdfMetadataSuggestions(
      "Title: Local Research\nAuthor: Erika Muster\nCreationDate: Tue Jan 2 10:00:00 2024\nLanguage: de-DE\n",
      "Citation DOI 10.1234/example.42 and ISBN 978-3-16-148410-0.",
      "{}",
    );
    expect(result).toMatchObject({
      suggestedTitle: "Local Research",
      suggestedAuthor: "Erika Muster",
      suggestedIssuedDate: "2024",
      suggestedLanguage: "de-DE",
      suggestedDoi: "10.1234/example.42",
      suggestedIsbn: "9783161484100",
    });
  });

  it("preserves an existing title suggestion when PDF metadata is blank", () => {
    expect(extractPdfMetadataSuggestions("", "", '{"suggestedTitle":"Filename title"}').suggestedTitle).toBe("Filename title");
  });
});
