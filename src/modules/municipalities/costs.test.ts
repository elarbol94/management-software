import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregateMunicipalityCostCsv, parseEuroCents, parseSemicolonCsv } from "../../../scripts/update-municipality-costs";
import type { MunicipalityIndex } from "./data";
import {
  municipalityCostCategoryCents,
  median,
  municipalityCostPerCapita,
  municipalityCostRealPerCapita,
  municipalityPopulationBand,
  municipalityCostShare,
  validateMunicipalityCostSeries,
  type MunicipalityCostSeries,
} from "./costs";

const header = "Jahr;Bundesland;Voranschlag/Rechnungsabschluss;Datenquelle;Gemeindekennziffer;Gemeindename;Haushalt;Ansatz-Uab;Ansatz-Ugl;Konto-Grp;Konto-Ugl;Vorhabencode;Mvag;Ansatz-Text;Konto-Text;Wert";
const row = (mvag: string, category: string, value: string, text = "Text") =>
  `2024;Kärnten;Rechnungsabschluss;\"Statistik Austria\";20501;Althofen;Finanzierungshaushalt;${category}00;000;000;000;0000000;${mvag};\"${text}\";Konto;${value}`;

describe("municipality cost importer", () => {
  it("parses decimal-comma cents and quoted semicolon fields", () => {
    expect(parseEuroCents("1.234,5")).toBe(123_450);
    expect(parseEuroCents("-10,02")).toBe(-1_002);
    expect(parseSemicolonCsv('a;b\n\"x;y\";\"A \"\"quote\"\"\"')).toEqual([["a", "b"], ["x;y", 'A "quote"']]);
  });

  it("aggregates MVAG 32, 34 and 36 by task group and excludes inflows and non-budget cash entries", () => {
    const costs = aggregateMunicipalityCostCsv([
      header,
      row("3221", "0", "100,00", "Verwaltung; intern"),
      row("3415", "0", "50,00"),
      row("3614", "8", "200,00"),
      row("3225", "8", "-10,00"),
      row("3111", "2", "999,00"), row("3311", "2", "999,00"),
      row("3511", "2", "999,00"), row("4111", "2", "999,00"), row("4211", "2", "999,00"),
    ].join("\n"), "20501", 2024);
    expect(costs[0]).toBe(34_000);
    expect(municipalityCostCategoryCents(costs, "0")).toBe(15_000);
    expect(municipalityCostCategoryCents(costs, "8")).toBe(19_000);
    expect(municipalityCostShare(costs, "0")).toBeCloseTo(15 / 34);
  });

  it("calculates nominal and 2024-price per-capita costs", () => {
    const costs = aggregateMunicipalityCostCsv([header, row("3221", "0", "1.000,00")].join("\n"), "20501", 2024);
    expect(municipalityCostPerCapita(costs, "0", 200)).toBe(5);
    expect(municipalityCostRealPerCapita(costs, "0", 200, 2024)).toBe(5);
    expect(municipalityCostRealPerCapita(costs, "0", 200, 2010)).toBeCloseTo(7.4136, 3);
  });

  it("forms stable population bands and medians for peer comparisons", () => {
    expect(municipalityPopulationBand(999)).toBe(1);
    expect(municipalityPopulationBand(1_000)).toBe(2);
    expect(median([30, 10, 20, 40])).toBe(25);
  });

  it("rejects unexpected metadata and invalid totals", () => {
    expect(() => aggregateMunicipalityCostCsv([header, row("3111", "0", "10,00")].join("\n"), "20501", 2024)).toThrow("Nicht positive");
    expect(() => aggregateMunicipalityCostCsv([header, row("3221", "0", "10,00")].join("\n"), "20502", 2024)).toThrow("Unerwartete Metadaten");
  });
});

describe("generated municipality cost asset", () => {
  it("contains valid partial coverage for all 15 accounting years", () => {
    const index = JSON.parse(readFileSync(resolve("public/data/municipalities-at-2026.index.json"), "utf8")) as MunicipalityIndex;
    const series = JSON.parse(readFileSync(resolve("public/data/municipality-cost-shares-2010-2024.json"), "utf8")) as MunicipalityCostSeries;
    const codes = index.municipalities.map(({ municipalityCode }) => municipalityCode);
    expect(validateMunicipalityCostSeries(series, codes)).toBe(series);
    expect(Object.keys(series.years)).toHaveLength(15);
    expect(series.years["2024"].coverage).toBeGreaterThan(1_600);
    expect(series.years["2024"].coverage).toBeLessThanOrEqual(codes.length);
  });
});
