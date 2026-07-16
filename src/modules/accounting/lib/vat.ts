// All amounts are integer cents. Floating point never touches stored values.

export const VAT_RATES = [20, 13, 10, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

export function isVatRate(value: number): value is VatRate {
  return (VAT_RATES as readonly number[]).includes(value);
}

/** Kaufmännisches Runden (round half up) for non-negative values. */
function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export type VatBreakdown = {
  grossCents: number;
  netCents: number;
  vatCents: number;
};

/**
 * Split a gross amount into net + VAT. The net is rounded half up;
 * VAT is the exact remainder so net + vat === gross always holds.
 */
export function breakdownFromGross(
  grossCents: number,
  rate: VatRate,
): VatBreakdown {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error(`Invalid gross amount: ${grossCents}`);
  }
  if (!isVatRate(rate)) throw new Error(`Invalid VAT rate: ${rate}`);

  const netCents = roundHalfUp((grossCents * 100) / (100 + rate));
  return { grossCents, netCents, vatCents: grossCents - netCents };
}

/**
 * Compute gross from a net amount. VAT is rounded half up;
 * gross = net + vat always holds.
 */
export function breakdownFromNet(netCents: number, rate: VatRate): VatBreakdown {
  if (!Number.isInteger(netCents) || netCents < 0) {
    throw new Error(`Invalid net amount: ${netCents}`);
  }
  if (!isVatRate(rate)) throw new Error(`Invalid VAT rate: ${rate}`);

  const vatCents = roundHalfUp((netCents * rate) / 100);
  return { grossCents: netCents + vatCents, netCents, vatCents };
}
