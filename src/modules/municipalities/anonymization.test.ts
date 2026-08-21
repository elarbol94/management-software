import { describe, expect, it } from "vitest";
import { findRedactionMatches, type OcrWord } from "./anonymization";

function words(values: string[]): OcrWord[] {
  return values.map((text, id) => ({ id, text, line: "1" }));
}

describe("municipality minute anonymization", () => {
  it("redacts names following a title and unnamed name pairs", () => {
    const input = words(["Herr", "Max", "Mustermann", "und", "Anna", "Musterfrau"]);
    expect(findRedactionMatches(input).map((match) => match.wordId).sort((left, right) => left - right)).toEqual([0, 1, 2, 4, 5]);
  });

  it("redacts contact data and values after sensitive labels", () => {
    const input = words(["E-Mail:", "max@example.at", "Tel.", "+43", "664", "123456", "Adresse:", "Hauptstraße", "1"]);
    const matches = findRedactionMatches(input);
    expect(matches.map((match) => match.wordId)).toEqual(expect.arrayContaining([1, 3, 4, 5, 7, 8]));
  });
});
