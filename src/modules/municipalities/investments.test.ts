import { describe, expect, it } from "vitest";
import {
  matchInvestmentAssets,
  parseEuroCents,
  parseMunicipalityAssetCsv,
  parseMunicipalityInvestmentCsv,
  parseSemicolonCsv,
  reconcileMunicipalityAssetSources,
  reconcileMunicipalityInvestmentSources,
} from "../../../scripts/update-municipality-investments";
import { renderMunicipalityInvestmentHtml, renderMunicipalityInvestmentIndexHtml } from "./investment-html";
import {
  MUNICIPALITY_INVESTMENTS_FIRST_YEAR,
  MUNICIPALITY_INVESTMENTS_LATEST_YEAR,
  MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION,
  normalizeInvestmentDescription,
  validateMunicipalityInvestmentData,
  type MunicipalityInvestmentData,
  type MunicipalityInvestmentIndex,
} from "./investments";

const header = "Jahr;Bundesland;Voranschlag/Rechnungsabschluss;Datenquelle;Gemeindekennziffer;Gemeindename;Haushalt;Ansatz-Uab;Ansatz-Ugl;Konto-Grp;Konto-Ugl;Vorhabencode;Mvag;Ansatz-Text;Konto-Text;Wert";
const row = ({ source = "Statistik Austria", mvag = "3415", value = "100,00", account = "Ausstattung", accountSub = "000" } = {}) =>
  `2024;Oberösterreich;Rechnungsabschluss;"${source}";41201;Andrichsfurt;Finanzierungshaushalt;163;006;042;${accountSub};1163006;${mvag};"Freiwillige Feuerwehr";"${account}";${value}`;

const assetHeader = "Jahr;Bundesland;Voranschlag/Rechnungsabschluss;Datenquelle;Gemeindekennziffer;Gemeindename;Haushalt;Ansatz-Uab;Ansatz-Ugl;Konto-Grp;Konto-Ugl;Vorhabencode;Id-Vhh;Sektor;Land;Mvag;Ansatz-Text;Konto-Text;Endstand-Vj;Zugang;Abgang;Aenderung;Endstand-Rj";
const assetRow = ({
  source = "Gemeinde", id = "V1", mvag = "1026", approach = "Freiwillige Feuerwehr",
  account = "Ausstattung", opening = "0,00", addition = "100,00", disposal = "0,00",
  change = "0,00", closing = "100,00", accountSub = "000",
} = {}) => `2024;Oberösterreich;Rechnungsabschluss;"${source}";41201;Andrichsfurt;Vermögenshaushalt;163;006;042;${accountSub};0000000;${id};0000;AT;${mvag};"${approach}";"${account}";${opening};${addition};${disposal};${change};${closing}`;

describe("municipality investment importer", () => {
  it("parses quoted semicolons, decimal-comma cents and umlauts", () => {
    expect(parseEuroCents("1.234,5")).toBe(123_450);
    expect(parseSemicolonCsv('a;b\n"x;y";"Ä"')).toEqual([["a", "b"], ["x;y", "Ä"]]);
    const parsed = parseMunicipalityInvestmentCsv([
      header,
      row({ account: "Löschfahrzeug; Ausstattung", value: "1.234,50" }),
    ].join("\n"), "41201", 2024, "statistik_at");
    expect(parsed.directInvestmentCents).toBe(123_450);
    expect(parsed.positions[0].accountText).toBe("Löschfahrzeug; Ausstattung");
  });

  it("keeps negative corrections, drops zero totals and combines duplicate positions", () => {
    const parsed = parseMunicipalityInvestmentCsv([
      header,
      row({ value: "100,00" }),
      row({ value: "25,00" }),
      row({ account: "Berichtigung", accountSub: "001", value: "-10,00" }),
      row({ account: "Nullposition", accountSub: "002", value: "0,00" }),
      row({ mvag: "3331", value: "50,00" }),
      row({ mvag: "3431", value: "20,00" }),
    ].join("\n"), "41201", 2024, "statistik_at");
    expect(parsed.positions.map(({ amountCents }) => amountCents)).toEqual([12_500, -1_000]);
    expect(parsed.directInvestmentCents).toBe(11_500);
    expect(parsed.investiveInflowsCents).toBe(5_000);
    expect(parsed.investiveOutflowsCents).toBe(13_500);
  });

  it("uses municipality detail only when the direct-investment total reconciles exactly", () => {
    const statistics = parseMunicipalityInvestmentCsv([header, row({ value: "100,00" })].join("\n"), "41201", 2024, "statistik_at");
    const matching = parseMunicipalityInvestmentCsv([header, row({ source: "Gemeinde", value: "100,00" })].join("\n"), "41201", 2024, "gemeinde");
    const mismatch = parseMunicipalityInvestmentCsv([header, row({ source: "Gemeinde", value: "99,00" })].join("\n"), "41201", 2024, "gemeinde");
    expect(reconcileMunicipalityInvestmentSources(statistics, matching).detailLevel).toBe("municipality");
    const fallback = reconcileMunicipalityInvestmentSources(statistics, mismatch);
    expect(fallback.detailLevel).toBe("statistics");
    expect(fallback.reconciliation).toBe("mismatch-fallback");
  });

  it("imports only approved asset classes and never exposes bank or IBAN rows", () => {
    const parsed = parseMunicipalityAssetCsv([
      assetHeader,
      assetRow(),
      assetRow({ id: "BANK", mvag: "1230", account: "IBAN: AT12 3456 7890 1234 5678" }),
    ].join("\n"), "41201", 2024, "gemeinde", "assets.csv");
    expect(parsed.assets).toHaveLength(1);
    expect(JSON.stringify(parsed.assets)).not.toContain("IBAN");
    expect(() => parseMunicipalityAssetCsv([
      assetHeader,
      assetRow({ mvag: "1026", account: "Gerät IBAN: AT12 3456 7890 1234 5678" }),
    ].join("\n"), "41201", 2024, "gemeinde")).toThrow(/IBAN/);
  });

  it("uses VHH detail only when opening and closing balances reconcile by asset class", () => {
    const statistics = parseMunicipalityAssetCsv([
      assetHeader,
      assetRow({ source: "Statistik Austria", opening: "20,00", addition: "", closing: "120,00" }),
    ].join("\n"), "41201", 2024, "statistik_at");
    const matching = parseMunicipalityAssetCsv([
      assetHeader,
      assetRow({ opening: "20,00", addition: "100,00", closing: "120,00" }),
    ].join("\n"), "41201", 2024, "gemeinde");
    const mismatch = parseMunicipalityAssetCsv([
      assetHeader,
      assetRow({ opening: "20,00", addition: "99,00", closing: "119,00" }),
    ].join("\n"), "41201", 2024, "gemeinde");
    expect(reconcileMunicipalityAssetSources(statistics, matching).reconciliation).toBe("matched");
    expect(reconcileMunicipalityAssetSources(statistics, mismatch).reconciliation).toBe("mismatch-fallback");
  });

  it("matches exact 1:1, unique 1:n and unique n:1 asset additions cent-exactly", () => {
    const onePosition = parseMunicipalityInvestmentCsv([header, row({ source: "Gemeinde", value: "100,00" })].join("\n"), "41201", 2024, "gemeinde").positions;
    const oneAsset = parseMunicipalityAssetCsv([assetHeader, assetRow()].join("\n"), "41201", 2024, "gemeinde").assets;
    expect(matchInvestmentAssets(onePosition, oneAsset)[0]).toMatchObject({ assetMatchStatus: "matched", assetMatchMethod: "exact-description" });

    const splitPosition = parseMunicipalityInvestmentCsv([header, row({ source: "Gemeinde", mvag: "3412", value: "100,00", account: "Gemeindestraßen Sanierung" })].join("\n"), "41201", 2024, "gemeinde").positions;
    const splitAssets = parseMunicipalityAssetCsv([
      assetHeader,
      assetRow({ id: "A", mvag: "1021", account: "Gemeindestraßen Sanierung Teil A", addition: "40,00", closing: "40,00" }),
      assetRow({ id: "B", mvag: "1021", account: "Gemeindestraßen Sanierung Teil B", addition: "60,00", closing: "60,00", accountSub: "001" }),
    ].join("\n"), "41201", 2024, "gemeinde").assets;
    expect(matchInvestmentAssets(splitPosition, splitAssets)[0]).toMatchObject({ assetMatchStatus: "matched", assetMatchMethod: "group-sum", assetIds: expect.arrayContaining([splitAssets[0].id, splitAssets[1].id]) });

    const combinedPositions = parseMunicipalityInvestmentCsv([
      header,
      row({ source: "Gemeinde", value: "40,00", account: "Scheuersaugautomat Schule", accountSub: "001" }),
      row({ source: "Gemeinde", value: "60,00", account: "Scheuersaugautomat Schule", accountSub: "002" }),
    ].join("\n"), "41201", 2024, "gemeinde").positions;
    const combinedAsset = parseMunicipalityAssetCsv([
      assetHeader,
      assetRow({ account: "Scheuersaugautomat Schule zentral", addition: "100,00", closing: "100,00" }),
    ].join("\n"), "41201", 2024, "gemeinde").assets;
    expect(matchInvestmentAssets(combinedPositions, combinedAsset).every((position) => position.assetMatchStatus === "matched" && position.assetMatchMethod === "group-sum")).toBe(true);
  });

  it("marks non-unique asset assignments as ambiguous instead of guessing", () => {
    const positions = parseMunicipalityInvestmentCsv([header, row({ source: "Gemeinde", mvag: "3414", value: "100,00", account: "Gerät" })].join("\n"), "41201", 2024, "gemeinde").positions;
    const assets = parseMunicipalityAssetCsv([
      assetHeader,
      assetRow({ id: "A", mvag: "1025", account: "Maschine A" }),
      assetRow({ id: "B", mvag: "1025", account: "Maschine B", accountSub: "001" }),
    ].join("\n"), "41201", 2024, "gemeinde").assets;
    expect(matchInvestmentAssets(positions, assets)[0]).toMatchObject({ assetMatchStatus: "ambiguous", assetIds: [] });
  });

  it("normalizes descriptions for later comparisons", () => {
    expect(normalizeInvestmentDescription("  Lösch-Fahrzeug Straße  ")).toBe("losch fahrzeug strasse");
  });
});

function fixtureData(): MunicipalityInvestmentData {
  const parsed = parseMunicipalityInvestmentCsv([
    header,
    row({ account: "</script><script>window.bad=true</script>", value: "100,00" }),
  ].join("\n"), "41201", 2024, "statistik_at");
  return validateMunicipalityInvestmentData({
    schemaVersion: MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION,
    municipality: { code: "41201", name: "Andrichsfurt", state: "Oberösterreich" },
    firstYear: MUNICIPALITY_INVESTMENTS_FIRST_YEAR,
    latestYear: MUNICIPALITY_INVESTMENTS_LATEST_YEAR,
    availableYears: [2024], generatedAt: "2026-08-21T00:00:00.000Z", unit: "cents",
    source: { title: "Statistik Austria via OffenerHaushalt.at", url: "https://www.offenerhaushalt.at/", definitionUrl: "https://www.bmf.gv.at/themen/budget/finanzbeziehungen-laender-gemeinden/vrv-2015.html" },
    years: [{ year: 2024, directInvestmentCents: 10_000, investiveInflowsCents: 0, investiveOutflowsCents: 10_000, investiveBalanceCents: -10_000, positionCount: 1, detailLevel: "statistics", statisticsFile: "source.csv", municipalityFile: null, reconciliation: "statistics-only", assetDetailLevel: "unavailable", assetStatisticsFile: null, assetMunicipalityFile: null, assetReconciliation: "unavailable" }],
    positions: parsed.positions,
    assets: [],
  });
}

describe("municipality investment HTML", () => {
  it("is self-contained, cross-filterable and escapes source text from the executable payload", () => {
    const html = renderMunicipalityInvestmentHtml(fixtureData(), "de");
    expect(html).toContain('id="investment-data"');
    expect(html).toContain('id="type-breakdown"');
    expect(html).toContain('id="detail-dialog"');
    expect(html).toContain("location.hash");
    expect(html).toContain("<noscript>");
    expect(html).not.toContain("<script>window.bad=true</script>");
    expect(html).not.toContain('src="http');
  });

  it("adds a year selector and year deep links to the municipality index", () => {
    const data = fixtureData();
    const index: MunicipalityInvestmentIndex = {
      schemaVersion: MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION,
      firstYear: MUNICIPALITY_INVESTMENTS_FIRST_YEAR,
      latestYear: MUNICIPALITY_INVESTMENTS_LATEST_YEAR,
      generatedAt: data.generatedAt,
      municipalityCount: 1,
      skippedMunicipalityCount: 0,
      mismatchFallbackCount: 0,
      municipalities: [{
        code: "41201", name: "Andrichsfurt", state: "Oberösterreich", availableYears: [2024], missingYears: [],
        latestAvailableYear: 2024, directInvestmentCents: 10_000, latestYearInvestmentCents: 10_000, positionCount: 1,
        yearTotals: [{ year: 2024, directInvestmentCents: 10_000, positionCount: 1 }],
        htmlFile: "41201-andrichsfurt.html", dataFile: "41201.json",
      }],
      unavailableMunicipalities: [],
    };
    const html = renderMunicipalityInvestmentIndexHtml(index, "de");
    expect(html).toContain('id="index-year"');
    expect(html).toContain("'#year='");
    expect(html).toContain("yearTotals");
  });
});
