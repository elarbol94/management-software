import { describe, expect, it } from "vitest";
import { parseBibTeX, parseRis, toBibTeX, toRis } from "./interchange";

describe("bibliography interchange", () => {
  it("previews BibTeX records", () => {
    const [record] = parseBibTeX(`@article{smith2026,\n title={Knowledge systems},\n author={Smith, Jane},\n year={2026},\n doi={10.1000/test}\n}`);
    expect(record).toMatchObject({ type: "journalArticle", title: "Knowledge systems", issuedDate: "2026", doi: "10.1000/test" });
    expect(record.contributors[0]).toMatchObject({ family: "Smith", given: "Jane" });
  });
  it("previews compact BibTeX records and nested braces", () => {
    const [record] = parseBibTeX("@article{smith2026, title={Knowledge {Systems}}, author=\"Smith, Jane\"}");
    expect(record).toMatchObject({ type: "journalArticle", title: "Knowledge Systems" });
    expect(record.contributors[0]).toMatchObject({ family: "Smith", given: "Jane" });
  });
  it("supports given-name-first authors and ignores BibTeX directives", () => {
    const [record] = parseBibTeX(`
      @string{journal = "Example"}
      @comment{This is not a source}
      @preamble{"Ignored"}
      @article{doe2026, title={Example}, author={Jane Mary Doe}}
    `);
    expect(record.contributors[0]).toMatchObject({ family: "Doe", given: "Jane Mary" });
    expect(parseBibTeX("@comment{Nothing to import}")).toEqual([]);
  });
  it("previews RIS records", () => {
    const [record] = parseRis("TY  - JOUR\nTI  - Knowledge systems\nAU  - Smith, Jane\nPY  - 2026\nER  -");
    expect(record).toMatchObject({ type: "journalArticle", title: "Knowledge systems", issuedDate: "2026" });
  });
  it("exports standard fields", () => {
    const source = { id: "s1", type: "book", title: "A Book", issuedDate: "2026", containerTitle: "", publisher: "Press", volume: "", issue: "", pages: "", doi: "", isbn: "123", url: "", contributors: [{ given: "Jane", family: "Smith", literal: "" }] };
    expect(toBibTeX(source)).toContain("@book{s1");
    expect(toRis(source)).toContain("TY  - BOOK");
  });
});
