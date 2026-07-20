import { describe, expect, it } from "vitest";
import { formatBibliographyEntry, formatInlineCitation, normalizeDoi, normalizeIsbn, normalizeUrl, type CitationSource } from "./citations";

const source: CitationSource = {
  id: "source-1", type: "journalArticle", title: "Knowledge systems", issuedDate: "2026",
  containerTitle: "Journal of Research", publisher: "", institution: "", volume: "4", issue: "2", pages: "12-20",
  doi: "10.1000/test", url: "", accessedAt: "",
  contributors: [{ role: "author", given: "Jane", family: "Smith", literal: "", sortOrder: 0 }],
};

describe("citation formatting", () => {
  it("formats localized inline locators", () => {
    expect(formatInlineCitation(source, "14", "en-US")).toBe("(Smith, 2026, p. 14)");
    expect(formatInlineCitation(source, "14", "de-DE")).toBe("(Smith, 2026, S. 14)");
  });
  it("formats a stable bibliography entry", () => {
    expect(formatBibliographyEntry(source)).toContain("Smith, J. (2026). Knowledge systems.");
    expect(formatBibliographyEntry(source)).toContain("https://doi.org/10.1000/test");
  });
});

describe("identifier normalization", () => {
  it("normalizes identifiers and URLs", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeIsbn("978-1-4028-9462-6")).toBe("9781402894626");
    expect(normalizeUrl("https://example.com/path/#section")).toBe("https://example.com/path");
  });
});
