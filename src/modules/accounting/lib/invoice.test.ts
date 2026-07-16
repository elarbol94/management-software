import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  formatInvoiceNumber,
  lineNetCents,
} from "./invoice";

describe("lineNetCents", () => {
  it("multiplies quantity (×1000) by unit price", () => {
    expect(
      lineNetCents({
        description: "",
        quantityThousandths: 2500, // 2.5
        unitPriceCents: 12000, // 120.00 €
        vatRate: 20,
      }),
    ).toBe(30000); // 300.00 €
  });

  it("rounds half up on fractional results", () => {
    expect(
      lineNetCents({
        description: "",
        quantityThousandths: 333, // 0.333
        unitPriceCents: 100,
        vatRate: 20,
      }),
    ).toBe(33); // 33.3 → 33
  });
});

describe("computeInvoiceTotals", () => {
  it("groups by VAT rate with per-group VAT", () => {
    const totals = computeInvoiceTotals([
      { description: "Beratung", quantityThousandths: 1000, unitPriceCents: 10000, vatRate: 20 },
      { description: "Workshop", quantityThousandths: 2000, unitPriceCents: 5000, vatRate: 20 },
      { description: "Buch", quantityThousandths: 1000, unitPriceCents: 2000, vatRate: 10 },
    ]);

    expect(totals.byRate).toEqual([
      { vatRate: 20, netCents: 20000, vatCents: 4000, grossCents: 24000 },
      { vatRate: 10, netCents: 2000, vatCents: 200, grossCents: 2200 },
    ]);
    expect(totals.netCents).toBe(22000);
    expect(totals.vatCents).toBe(4200);
    expect(totals.grossCents).toBe(26200);
  });

  it("handles 0% (Kleinunternehmer / exempt)", () => {
    const totals = computeInvoiceTotals([
      { description: "x", quantityThousandths: 1000, unitPriceCents: 5000, vatRate: 0 },
    ]);
    expect(totals.vatCents).toBe(0);
    expect(totals.grossCents).toBe(5000);
  });

  it("rejects invalid rates", () => {
    expect(() =>
      computeInvoiceTotals([
        { description: "x", quantityThousandths: 1000, unitPriceCents: 100, vatRate: 19 },
      ]),
    ).toThrow();
  });

  it("returns empty totals for no items", () => {
    const totals = computeInvoiceTotals([]);
    expect(totals.grossCents).toBe(0);
    expect(totals.byRate).toEqual([]);
  });
});

describe("formatInvoiceNumber", () => {
  it("pads the sequence to four digits", () => {
    expect(formatInvoiceNumber("RE-", 2026, 7)).toBe("RE-2026-0007");
    expect(formatInvoiceNumber("", 2026, 1234)).toBe("2026-1234");
  });
});
