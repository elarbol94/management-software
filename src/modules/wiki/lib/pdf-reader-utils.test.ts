import { describe, expect, it } from "vitest";
import {
  calculateFitScale,
  findSearchOccurrences,
  formatPdfCitation,
  parsePdfReaderPreferences,
  resolveInitialPage,
  virtualPageWindow,
} from "./pdf-reader-utils";

describe("PDF reader utilities", () => {
  it("parses and clamps persisted preferences", () => {
    expect(parsePdfReaderPreferences('{"version":1,"scale":9,"navigatorWidth":20,"commentPanelWidth":999,"viewMode":"double","fitMode":"page","rotation":90,"color":"blue","navigatorTab":"outline","navigatorVisible":false}')).toMatchObject({
      scale: 3, navigatorWidth: 104, commentPanelWidth: 420, viewMode: "double",
      fitMode: "page", rotation: 90, navigatorTab: "outline", navigatorVisible: false,
    });
    expect(parsePdfReaderPreferences("{damaged").version).toBe(1);
  });

  it("calculates fit modes", () => {
    expect(calculateFitScale({ mode: "width", pageWidth: 600, pageHeight: 800, viewportWidth: 632, viewportHeight: 500 })).toBe(1);
    expect(calculateFitScale({ mode: "page", pageWidth: 600, pageHeight: 800, viewportWidth: 932, viewportHeight: 432 })).toBe(0.5);
    expect(calculateFitScale({ mode: "custom", pageWidth: 1, pageHeight: 1, viewportWidth: 1, viewportHeight: 1 })).toBeNull();
  });

  it("finds every literal occurrence", () => {
    const results = findSearchOccurrences([{ pageNumber: 1, text: "Alpha beta alpha" }, { pageNumber: 2, text: "ALPHA" }], "alpha");
    expect(results.map((item) => item.pageNumber)).toEqual([1, 1, 2]);
  });

  it("prefers an explicit valid page over stored state", () => {
    expect(resolveInitialPage({ requestedPage: 4, storedPage: 2, pageCount: 6 })).toBe(4);
    expect(resolveInitialPage({ requestedPage: 20, storedPage: 2, pageCount: 6 })).toBe(2);
  });

  it("returns a bounded viewport window plus a retained target", () => {
    expect(virtualPageWindow({
      pageOffsets: [
        { pageNumber: 1, top: 0, bottom: 100 },
        { pageNumber: 2, top: 110, bottom: 210 },
        { pageNumber: 3, top: 220, bottom: 320 },
        { pageNumber: 4, top: 330, bottom: 430 },
      ],
      scrollTop: 120, viewportHeight: 100, overscan: 20, retainedPage: 4,
    })).toEqual([1, 2, 3, 4]);
  });

  it("formats a compact page citation", () => {
    expect(formatPdfCitation("Research", 7, "  useful\ntext ")).toBe("“useful text” — Research, p. 7");
  });
});
