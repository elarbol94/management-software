import { describe, expect, it } from "vitest";
import { collectSpellcheckUnits } from "./spellcheck-units";

describe("sentence proofing contexts", () => {
  it("bounds an edit to neighboring sentences and preserves document offsets", () => {
    const text = "Erster Satz. Zweiter Satz. Dritter Satz. Vierter Satz. Fünfter Satz.";
    const units = collectSpellcheckUnits([{ text, from: 19, excludedRanges: [] }], "de-DE");
    expect(units).toHaveLength(5);
    expect(units[2].text).toBe("Zweiter Satz. Dritter Satz. Vierter Satz. ");
    for (const unit of units) {
      expect(text.slice(unit.contextOffset, unit.contextOffset + unit.text.length)).toBe(unit.text);
      expect(unit.text.slice(unit.offset - unit.contextOffset, unit.end - unit.contextOffset)).toBe(text.slice(unit.offset, unit.end));
    }
  });

  it("retains every UTF-16 position across emoji, hard breaks, abbreviations and long sentences", () => {
    const text = 'Dr. Mayer sagt: „Grüße 👋!“\nDann folgt ' + "lang ".repeat(5_000) + "Ende.";
    const units = collectSpellcheckUnits([{ text, from: 1, excludedRanges: [] }], "de-AT");
    expect(units.map((unit) => text.slice(unit.offset, unit.end)).join("")).toBe(text);
    for (const unit of units) expect(unit.text.length).toBeLessThanOrEqual(12_000);
  });

  it("does not split a surrogate pair at the long-sentence boundary", () => {
    const text = "x".repeat(11_999) + "👋" + "x".repeat(13_000);
    const units = collectSpellcheckUnits([{ text, from: 1, excludedRanges: [] }], "en-US");
    expect(units[0].end).toBe(11_999);
    expect(units[1].text.startsWith("👋")).toBe(true);
    expect(units.map((unit) => text.slice(unit.offset, unit.end)).join("")).toBe(text);
  });
});
