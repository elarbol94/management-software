import { describe, expect, it } from "vitest";
import { figureNumberLabel, hasOwnFigureNumber } from "./figure-caption";

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

  it("adds a label only where the caption has none", () => {
    expect(figureNumberLabel("Sparquote der Haushalte", "Abbildung", 3)).toBe("Abbildung 3");
    expect(figureNumberLabel("Abbildung 4: Hauseigentum", "Abbildung", 1)).toBe("");
  });
});
