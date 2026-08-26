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

describe("editors", () => {
  it("keeps BibTeX editors instead of discarding them", () => {
    const [record] = parseBibTeX(`@book{k, title={Sammelband}, editor={Müller, Anna and Huber, Josef}, year={2024}}`);
    expect(record.contributors).toEqual([
      { role: "editor", family: "Müller", given: "Anna", literal: "" },
      { role: "editor", family: "Huber", given: "Josef", literal: "" },
    ]);
  });

  it("keeps both roles, and in the right roles", () => {
    const [record] = parseBibTeX(`@inbook{k, title={Kapitel}, author={Berger, Eva}, editor={Müller, Anna}, year={2024}}`);
    expect(record.contributors.map((person) => [person.role, person.family])).toEqual([
      ["author", "Berger"],
      ["editor", "Müller"],
    ]);
  });

  it("reads the RIS ED tag alongside AU", () => {
    const [record] = parseRis("TY  - BOOK\nTI  - Sammelband\nAU  - Berger, Eva\nED  - Müller, Anna\nER  - ");
    expect(record.contributors.map((person) => [person.role, person.family])).toEqual([
      ["author", "Berger"],
      ["editor", "Müller"],
    ]);
  });

  it("round-trips editors back out to BibTeX and RIS", () => {
    const source = {
      id: "s1", type: "book", title: "Sammelband", issuedDate: "2024", containerTitle: "", publisher: "",
      volume: "", issue: "", pages: "", doi: "", isbn: "", url: "",
      contributors: [
        { given: "Eva", family: "Berger", literal: "", role: "author" },
        { given: "Anna", family: "Müller", literal: "", role: "editor" },
      ],
    };
    const bib = toBibTeX(source);
    expect(bib).toContain("author = {Berger, Eva}");
    expect(bib).toContain("editor = {Müller, Anna}");

    const ris = toRis(source);
    expect(ris).toContain("AU  - Berger, Eva");
    expect(ris).toContain("ED  - Müller, Anna");
  });

  it("survives a full export/import cycle without changing roles", () => {
    const source = {
      id: "s1", type: "book", title: "Sammelband", issuedDate: "2024", containerTitle: "", publisher: "",
      volume: "", issue: "", pages: "", doi: "", isbn: "", url: "",
      contributors: [{ given: "Anna", family: "Müller", literal: "", role: "editor" }],
    };
    const [back] = parseBibTeX(toBibTeX(source));
    expect(back.contributors).toEqual([{ role: "editor", family: "Müller", given: "Anna", literal: "" }]);
  });
});
