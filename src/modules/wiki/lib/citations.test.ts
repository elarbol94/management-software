import { describe, expect, it } from "vitest";
import { formatBibliography, formatBibliographyEntry, formatInlineCitation, normalizeDoi, normalizeIsbn, normalizeUrl, toCslJson, type CitationSource } from "./citations";

const source: CitationSource = {
  id: "source-1", type: "journalArticle", title: "Knowledge systems", issuedDate: "2026",
  containerTitle: "Journal of Research", publisher: "", institution: "", volume: "4", issue: "2", pages: "12-20",
  doi: "10.1000/test", url: "", accessedAt: "",
  contributors: [{ role: "author", given: "Jane", family: "Smith", literal: "", sortOrder: 0 }],
};

describe("citation formatting", () => {
  it("formats numbered IEEE inline locators", () => {
    expect(formatInlineCitation(source, "14", "en-US", 3)).toBe("[3, p. 14]");
    expect(formatInlineCitation(source, undefined, "de-DE", 2)).toBe("[2]");
  });
  it("formats a stable IEEE bibliography entry", () => {
    expect(formatBibliographyEntry(source)).toContain('J. Smith, “Knowledge systems,”');
    expect(formatBibliographyEntry(source)).toContain("Journal of Research, vol. 4, no. 2, pp. 12-20, 2026");
    expect(formatBibliographyEntry(source)).toContain("doi: 10.1000/test");
  });
  it("maps every supported source kind to CSL and de-duplicates a bibliography", () => {
    const expected = {
      journalArticle: "article-journal",
      book: "book",
      bookChapter: "chapter",
      report: "report",
      webPage: "webpage",
      document: "document",
    };
    for (const [type, cslType] of Object.entries(expected)) {
      expect(toCslJson({ ...source, type }).type).toBe(cslType);
    }
    expect(formatBibliography([source, source], "en-US")).toEqual([
      expect.objectContaining({ text: expect.stringMatching(/^\[1\]/) }),
    ]);
  });
  it("uses IEEE contributor initials and a stable missing-date label", () => {
    const manyAuthors: CitationSource = {
      ...source,
      issuedDate: "",
      contributors: [
        source.contributors[0],
        { role: "author", given: "John", family: "Miller", literal: "", sortOrder: 1 },
        { role: "author", given: "Alex", family: "Taylor", literal: "", sortOrder: 2 },
      ],
    };
    expect(formatInlineCitation(manyAuthors)).toBe("[1]");
    expect(formatBibliographyEntry(manyAuthors)).toContain("J. Smith, J. Miller, A. Taylor");
    expect(formatBibliographyEntry(manyAuthors)).toContain("n.d.");
  });
});

describe("identifier normalization", () => {
  it("normalizes identifiers and URLs", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeIsbn("978-1-4028-9462-6")).toBe("9781402894626");
    expect(normalizeUrl("https://example.com/path/#section")).toBe("https://example.com/path");
  });
});
