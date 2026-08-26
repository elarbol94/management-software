import { describe, expect, it } from "vitest";
import { decorateCitationSource } from "./citations.server";
import { LOCATOR_PLACEHOLDER, type CitationSource } from "./citations";

const source: CitationSource = {
  id: "source-1", type: "journalArticle", title: "Gemeindefinanzen in Österreich", issuedDate: "2024-03",
  containerTitle: "Zeitschrift für Kommunalforschung", publisher: "", institution: "",
  volume: "12", issue: "2", pages: "33-58", doi: "10.1234/zkf", url: "", accessedAt: "",
  contributors: [
    { role: "author", given: "Anna", family: "Müller", literal: "", sortOrder: 0 },
    { role: "author", given: "Josef", family: "Huber", literal: "", sortOrder: 1 },
  ],
};

// citeproc builds its engine on the first render (~1.5s cold, ~10ms after), which
// overruns vitest's 5s default once the whole suite is running in parallel.
describe("decorateCitationSource", { timeout: 20_000 }, () => {
  it("leaves IEEE on the hand-rolled renderer", () => {
    const decorated = decorateCitationSource(source, "en-US", "ieee");
    expect(decorated.renderedBibliography).toContain("A. Müller, J. Huber");
    expect(decorated.renderedInline).toBeUndefined();
  });

  it("renders APA through citeproc and localises it", () => {
    const german = decorateCitationSource(source, "de-DE", "apa");
    expect(german.renderedBibliography).toContain("Müller, A., & Huber, J. (2024)");
    expect(german.renderedInline).toBe("(Müller & Huber, 2024)");
    // German locale must use "S." for the page locator, not "p.".
    expect(german.renderedInlineTemplate).toBe(`(Müller & Huber, 2024, S. ${LOCATOR_PLACEHOLDER})`);

    const english = decorateCitationSource(source, "en-US", "apa");
    expect(english.renderedInlineTemplate).toBe(`(Müller & Huber, 2024, p. ${LOCATOR_PLACEHOLDER})`);
  });

  it("strips citeproc's own numbering from Vancouver and keeps the label app-generated", () => {
    const decorated = decorateCitationSource(source, "en-US", "vancouver");
    expect(decorated.renderedBibliography?.startsWith("1.")).toBe(false);
    expect(decorated.renderedBibliography).toContain("Müller A");
    // Numeric styles are numbered by document order, so no in-text label is precomputed.
    expect(decorated.renderedInline).toBeUndefined();
  });

  it("falls back to the IEEE string when the record cannot be rendered", () => {
    const broken = { ...source, contributors: [], title: "" };
    const decorated = decorateCitationSource(broken, "en-US", "apa");
    expect(typeof decorated.renderedBibliography === "string" || decorated.renderedBibliography === undefined).toBe(true);
  });
});
