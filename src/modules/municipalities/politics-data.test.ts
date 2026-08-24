import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateMunicipalityIndex, type MunicipalityIndex } from "./data";
import {
  validateMunicipalityCurrentPolitics,
  validateMunicipalityElectionHistory,
  type MunicipalityCurrentPoliticsDataset,
  type MunicipalityElectionHistoryDataset,
} from "./politics";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

describe("generated municipality politics datasets", () => {
  const index = readJson<MunicipalityIndex>("public/data/municipalities-at-2026.index.json");
  const codes = validateMunicipalityIndex(index).municipalities.map(({ municipalityCode }) => municipalityCode);
  const current = readJson<MunicipalityCurrentPoliticsDataset>("public/data/municipality-politics-current-2026.json");
  const history = readJson<MunicipalityElectionHistoryDataset>("public/data/municipality-election-history-2000-2025.json");

  it("contains a current, sourced mayor entry for every 2026 municipality", () => {
    expect(validateMunicipalityCurrentPolitics(current, codes)).toBe(current);
    expect(Object.values(current.municipalities).filter(({ mayor }) => mayor)).toHaveLength(2_092);
    expect(Object.values(current.municipalities).every(({ mayorSourceIds }) => mayorSourceIds.length > 0)).toBe(true);
  });

  it("keeps every missing mayor party explicit", () => {
    for (const item of Object.values(current.municipalities)) {
      if (item.mayor?.party === null) expect(item.missingReasons.mayorParty).toBe("not-published");
    }
  });

  it("validates all election invariants and source references", () => {
    expect(validateMunicipalityElectionHistory(history, codes)).toBe(history);
    const sourceIds = new Set(history.sources.map(({ id }) => id));
    for (const municipality of Object.values(history.municipalities)) {
      for (const event of municipality.events) {
        expect(event.sourceIds.every((id) => sourceIds.has(id))).toBe(true);
      }
    }
  });

  it("stores checksums for all sources used by generated values", () => {
    const used = new Set([
      ...Object.values(current.municipalities).flatMap(({ mayorSourceIds, latestCouncil }) => [...mayorSourceIds, ...(latestCouncil?.sourceIds ?? [])]),
      ...Object.values(history.municipalities).flatMap(({ events }) => events.flatMap(({ sourceIds }) => sourceIds)),
    ]);
    for (const source of history.sources.filter(({ id }) => used.has(id))) {
      expect(source.sha256, source.id).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
