import { describe, expect, it } from "vitest";
import { buildEntriesCsv, type CsvEntry } from "./csv";

const baseEntry: CsvEntry = {
  date: "2026-07-15",
  kind: "income",
  description: "Beratung Juli",
  counterparty: "ACME GmbH",
  categoryName: "Erlöse 20 % USt",
  paymentMethod: "bank",
  netAmountCents: 100000,
  vatRate: 20,
  vatAmountCents: 20000,
  grossAmountCents: 120000,
  notes: "",
};

describe("buildEntriesCsv", () => {
  it("starts with a UTF-8 BOM and a header row", () => {
    const csv = buildEntriesCsv([]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Datum;Art;Beschreibung");
  });

  it("formats dates as DD.MM.YYYY and amounts with decimal comma", () => {
    const csv = buildEntriesCsv([baseEntry]);
    expect(csv).toContain(
      "15.07.2026;Einnahme;Beratung Juli;ACME GmbH;Erlöse 20 % USt;Bank;1000,00;20;200,00;1200,00;",
    );
  });

  it("escapes fields containing semicolons and quotes", () => {
    const csv = buildEntriesCsv([
      {
        ...baseEntry,
        description: 'Hosting; Zusatz "Premium"',
      },
    ]);
    expect(csv).toContain('"Hosting; Zusatz ""Premium"""');
  });

  it("uses CRLF line endings", () => {
    const csv = buildEntriesCsv([baseEntry]);
    expect(csv.split("\r\n")).toHaveLength(3); // header + row + trailing
  });
});
