import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCrossrefWork } from "./crossref";

function respondWith(message: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => ({ message }) })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCrossrefWork", () => {
  it("maps a journal article onto the source shape", async () => {
    respondWith({
      type: "journal-article",
      title: ["Gemeindefinanzen in Österreich"],
      subtitle: ["Eine Bestandsaufnahme"],
      issued: { "date-parts": [[2024, 3, 14]] },
      "container-title": ["Zeitschrift für Kommunalforschung"],
      publisher: "Verlag Wien",
      volume: "12",
      issue: "2",
      page: "33-58",
      URL: "https://doi.org/10.1234/zkf",
      author: [{ given: "Anna", family: "Müller" }, { given: "Josef", family: "Huber" }],
    });
    const work = await fetchCrossrefWork("https://doi.org/10.1234/ZKF");
    expect(work.type).toBe("journalArticle");
    expect(work.title).toBe("Gemeindefinanzen in Österreich");
    expect(work.issuedDate).toBe("2024-3-14");
    expect(work.doi).toBe("10.1234/zkf"); // normalized out of the URL form
    expect(work.contributors).toEqual([
      { role: "author", given: "Anna", family: "Müller", literal: "" },
      { role: "author", given: "Josef", family: "Huber", literal: "" },
    ]);
  });

  it("maps book and chapter types, and falls back to document", async () => {
    for (const [crossrefType, expected] of [["book", "book"], ["book-chapter", "bookChapter"], ["dataset", "document"]]) {
      respondWith({ type: crossrefType, title: ["T"] });
      expect((await fetchCrossrefWork("10.1/x")).type).toBe(expected);
    }
  });

  it("tolerates a record with no authors, dates or container", async () => {
    respondWith({ type: "journal-article", title: ["Bare"] });
    const work = await fetchCrossrefWork("10.1/bare");
    expect(work.contributors).toEqual([]);
    expect(work.issuedDate).toBe("");
    expect(work.containerTitle).toBe("");
  });

  it("throws when the DOI is unknown, so callers can report or skip", async () => {
    respondWith({}, false);
    await expect(fetchCrossrefWork("10.1/missing")).rejects.toThrow("DOI metadata was not found");
  });
});
