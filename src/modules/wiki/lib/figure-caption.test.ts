import { describe, expect, it } from "vitest";
import {
  figureNumberLabel,
  hasOwnFigureNumber,
  ownFigureNumber,
  referenceLabel,
  referenceNumber,
  resolveCrossReferenceLabels,
} from "./figure-caption";

describe("figure captions", () => {
  it("recognises a caption that numbers itself", () => {
    // The Projektbeschreibung sidecars all open this way.
    expect(hasOwnFigureNumber("Abbildung 4: Am Land wohnt die Mehrheit im eigenen Haus")).toBe(true);
    expect(hasOwnFigureNumber("Figure 12. Quarterly revenue")).toBe(true);
    expect(hasOwnFigureNumber("Abb. 2 – Sparquote")).toBe(true);
  });

  it("treats an unnumbered caption as needing a number", () => {
    expect(hasOwnFigureNumber("Am Land wohnt die Mehrheit im eigenen Haus")).toBe(false);
    expect(hasOwnFigureNumber("")).toBe(false);
    // A year at the start is not a figure number.
    expect(hasOwnFigureNumber("2024: Ausgabenstruktur")).toBe(false);
  });

  it("numbers figures by document order even when a legacy caption had a number", () => {
    expect(figureNumberLabel("Sparquote der Haushalte", "Abbildung", 3)).toBe("Abbildung 3");
    expect(figureNumberLabel("Abbildung 4: Hauseigentum", "Abbildung", 1)).toBe("Abbildung 1");
  });
});

describe("ownFigureNumber", () => {
  it("extracts the number a caption already carries", () => {
    expect(ownFigureNumber("Abbildung 4: Hauseigentum")).toBe(4);
    expect(ownFigureNumber("Fig. 12. Quarterly revenue")).toBe(12);
  });

  it("returns null for a caption with no number of its own", () => {
    expect(ownFigureNumber("Sparquote der Haushalte")).toBeNull();
    expect(ownFigureNumber("")).toBeNull();
  });
});

describe("referenceNumber", () => {
  it("prefers the caption's own number over the sequential position", () => {
    expect(referenceNumber("Abbildung 4: Hauseigentum", 1)).toBe(4);
  });

  it("falls back to the sequential position for an unnumbered caption", () => {
    expect(referenceNumber("Sparquote der Haushalte", 3)).toBe(3);
  });
});

describe("referenceLabel", () => {
  it("echoes a self-numbered caption's own wording", () => {
    expect(referenceLabel("Abb. 2 – Sparquote", "Figure 5")).toBe("Abb. 2");
    expect(referenceLabel("Abbildung 4: Hauseigentum", "Abbildung 1")).toBe("Abbildung 4");
  });

  it("uses the supplied sequential label for an unnumbered caption", () => {
    expect(referenceLabel("Sparquote der Haushalte", "Abbildung 3")).toBe("Abbildung 3");
  });
});

describe("resolveCrossReferenceLabels", () => {
  it("labels every target kind in document order", () => {
    const labels = resolveCrossReferenceLabels({
      headings: [{ id: "intro", text: "Introduction" }],
      annexes: [{ id: "annex-1", title: "Budget breakdown" }],
      figures: [
        { id: "fig-a", caption: "Revenue by quarter" },
        { id: "fig-b", caption: "Abbildung 9: Bereits nummeriert" },
      ],
      tables: [{ id: "tbl-a", caption: "Key results" }],
      figureLabel: "Figure",
      tableLabel: "Table",
    });
    expect(labels.get("intro")).toBe("Introduction");
    expect(labels.get("annex-1")).toBe("Budget breakdown");
    expect(labels.get("fig-a")).toBe("Figure 1");
    // Legacy caption numbers cannot override document order.
    expect(labels.get("fig-b")).toBe("Figure 2");
    expect(labels.get("tbl-a")).toBe("Table 1");
  });

  it("skips targets with no id", () => {
    const labels = resolveCrossReferenceLabels({
      headings: [{ id: "", text: "Untitled" }],
      annexes: [],
      figures: [{ id: "", caption: "No id" }],
      tables: [],
      figureLabel: "Figure",
      tableLabel: "Table",
    });
    expect(labels.size).toBe(0);
  });
});
