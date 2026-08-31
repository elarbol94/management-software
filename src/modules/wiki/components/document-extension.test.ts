import { describe, expect, it } from "vitest";
import { numberHeadings, pageForPosition, type DocumentPaginationBreak } from "./document-extension";

describe("pageForPosition", () => {
  it("returns page 1 before any break", () => {
    expect(pageForPosition([], 5)).toBe(1);
    const breaks: DocumentPaginationBreak[] = [{ position: 100, height: 40, page: 2 }];
    expect(pageForPosition(breaks, 10)).toBe(1);
  });

  it("returns the page of the latest break at or before the position", () => {
    const breaks: DocumentPaginationBreak[] = [
      { position: 50, height: 40, page: 2 },
      { position: 150, height: 40, page: 3 },
      { position: 300, height: 40, page: 4 },
    ];
    expect(pageForPosition(breaks, 50)).toBe(2);
    expect(pageForPosition(breaks, 120)).toBe(2);
    expect(pageForPosition(breaks, 150)).toBe(3);
    expect(pageForPosition(breaks, 1000)).toBe(4);
  });

  it("does not require the break list to be sorted", () => {
    const breaks: DocumentPaginationBreak[] = [
      { position: 300, height: 40, page: 4 },
      { position: 50, height: 40, page: 2 },
      { position: 150, height: 40, page: 3 },
    ];
    expect(pageForPosition(breaks, 200)).toBe(3);
  });
});

describe("numberHeadings", () => {
  it("numbers levels 1-3 and resets deeper counters on a higher-level heading", () => {
    const labels = numberHeadings([
      { level: 1 }, // 1.
      { level: 2 }, // 1.1
      { level: 3 }, // 1.1.1
      { level: 2 }, // 1.2 (h3 counter reset)
      { level: 1 }, // 2. (h2/h3 counters reset)
      { level: 2 }, // 2.1
    ]);
    expect(labels).toEqual(["1. ", "1.1 ", "1.1.1 ", "1.2 ", "2. ", "2.1 "]);
  });

  it("leaves headings deeper than level 3 unnumbered", () => {
    const labels = numberHeadings([{ level: 1 }, { level: 4 }, { level: 6 }]);
    expect(labels).toEqual(["1. ", "", ""]);
  });
});
