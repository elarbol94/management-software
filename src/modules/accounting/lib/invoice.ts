import { isVatRate, type VatRate } from "./vat";

// Invoice line items store net unit prices; quantity is a ×1000 integer
// (e.g. 2.5 hours = 2500). VAT is computed per rate group over the summed
// net, as shown in the § 11 UStG per-rate breakdown on the invoice.

export type InvoiceItemInput = {
  description: string;
  quantityThousandths: number;
  unitPriceCents: number;
  vatRate: number;
};

export type RateGroup = {
  vatRate: VatRate;
  netCents: number;
  vatCents: number;
  grossCents: number;
};

export type InvoiceTotals = {
  netCents: number;
  vatCents: number;
  grossCents: number;
  byRate: RateGroup[];
};

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function lineNetCents(item: InvoiceItemInput): number {
  return roundHalfUp((item.quantityThousandths * item.unitPriceCents) / 1000);
}

export function computeInvoiceTotals(items: InvoiceItemInput[]): InvoiceTotals {
  const groups = new Map<VatRate, number>();
  for (const item of items) {
    if (!isVatRate(item.vatRate)) throw new Error(`Invalid VAT rate: ${item.vatRate}`);
    groups.set(item.vatRate, (groups.get(item.vatRate) ?? 0) + lineNetCents(item));
  }

  const byRate: RateGroup[] = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([vatRate, netCents]) => {
      const vatCents = roundHalfUp((netCents * vatRate) / 100);
      return { vatRate, netCents, vatCents, grossCents: netCents + vatCents };
    });

  return {
    netCents: byRate.reduce((sum, group) => sum + group.netCents, 0),
    vatCents: byRate.reduce((sum, group) => sum + group.vatCents, 0),
    grossCents: byRate.reduce((sum, group) => sum + group.grossCents, 0),
    byRate,
  };
}

/** e.g. prefix "RE-", year 2026, seq 7 → "RE-2026-0007" */
export function formatInvoiceNumber(
  prefix: string,
  year: number,
  seq: number,
): string {
  return `${prefix}${year}-${String(seq).padStart(4, "0")}`;
}
