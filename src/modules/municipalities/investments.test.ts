import { describe, expect, it } from "vitest";
import {
  parseEuroCents,
  parseMunicipalityInvestmentCsv,
  parseSemicolonCsv,
  reconcileMunicipalityInvestmentSources,
} from "../../../scripts/update-municipality-investments";
import { renderMunicipalityInvestmentHtml } from "./investment-html";
import {
  MUNICIPALITY_INVESTMENTS_FIRST_YEAR,
  MUNICIPALITY_INVESTMENTS_LATEST_YEAR,
  MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION,
  normalizeInvestmentDescription,
  validateMunicipalityInvestmentData,
  type MunicipalityInvestmentData,
} from "./investments";

const header = "Jahr;Bundesland;Voranschlag/Rechnungsabschluss;Datenquelle;Gemeindekennziffer;Gemeindename;Haushalt;Ansatz-Uab;Ansatz-Ugl;Konto-Grp;Konto-Ugl;Vorhabencode;Mvag;Ansatz-Text;Konto-Text;Wert";
const row = ({ source = "Statistik Austria", mvag = "3415", value = "100,00", account = "Ausstattung", accountSub = "000" } = {}) =>
  `2024;Oberösterreich;Rechnungsabschluss;"${source}";41201;Andrichsfurt;Finanzierungshaushalt;163;006;042;${accountSub};1163006;${mvag};"Freiwillige Feuerwehr";"${account}";${value}`;

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

  it("normalizes descriptions for later comparisons", () => {
    expect(normalizeInvestmentDescription("  Lösch-Fahrzeug Straße  ")).toBe("losch fahrzeug strasse");
  });
});

describe("municipality investment HTML", () => {
  it("is self-contained, interactive and escapes source text from the executable payload", () => {
    const parsed = parseMunicipalityInvestmentCsv([
      header,
      row({ account: "</script><script>window.bad=true</script>", value: "100,00" }),
    ].join("\n"), "41201", 2024, "statistik_at");
    const data: MunicipalityInvestmentData = validateMunicipalityInvestmentData({
      schemaVersion: MUNICIPALITY_INVESTMENTS_SCHEMA_VERSION,
      municipality: { code: "41201", name: "Andrichsfurt", state: "Oberösterreich" },
      firstYear: MUNICIPALITY_INVESTMENTS_FIRST_YEAR,
      latestYear: MUNICIPALITY_INVESTMENTS_LATEST_YEAR,
      availableYears: [2024], generatedAt: "2026-08-21T00:00:00.000Z", unit: "cents",
      source: { title: "Statistik Austria via OffenerHaushalt.at", url: "https://www.offenerhaushalt.at/", definitionUrl: "https://www.bmf.gv.at/themen/budget/finanzbeziehungen-laender-gemeinden/vrv-2015.html" },
      years: [{ year: 2024, directInvestmentCents: 10_000, investiveInflowsCents: 0, investiveOutflowsCents: 10_000, investiveBalanceCents: -10_000, positionCount: 1, detailLevel: "statistics", statisticsFile: "source.csv", municipalityFile: null, reconciliation: "statistics-only" }],
      positions: parsed.positions,
    });
    const html = renderMunicipalityInvestmentHtml(data, "de");
    expect(html).toContain('id="investment-data"');
    expect(html).toContain('id="year"');
    expect(html).toContain("Alle Jahre");
    expect(html).toContain("<noscript>");
    expect(html).not.toContain("<script>window.bad=true</script>");
    expect(html).not.toContain("src=\"http");
  });
});
