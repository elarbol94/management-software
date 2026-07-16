// Money helpers: integer cents in, formatted strings out.

const CURRENCY_LOCALES: Record<string, string> = {
  de: "de-AT",
  en: "en-IE", // English formatting with EUR defaults
};

export function formatCents(cents: number, locale: string): string {
  const intlLocale = CURRENCY_LOCALES[locale] ?? locale;
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency: "EUR",
  }).format(cents === 0 ? 0 : cents / 100); // avoid "-0,00" for negative zero
}

/** Format cents as a plain decimal with comma separator (de-AT), e.g. for CSV. */
export function formatCentsPlainDe(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}${euros},${rest}`;
}

/**
 * Parse a user-entered amount ("1.234,56", "1,234.56", "1234.5", "12") into
 * integer cents. Returns null for invalid input. Accepts comma or dot as the
 * decimal separator; when both appear, the last one wins as decimal separator.
 */
export function parseAmountToCents(input: string): number | null {
  const raw = input.trim().replace(/[€\s]/g, "");
  if (!raw) return null;

  const negative = raw.startsWith("-");
  const cleaned = negative ? raw.slice(1) : raw;
  if (!/^[\d.,]+$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const sepIndex = Math.max(lastComma, lastDot);

  let intPart: string;
  let fracPart: string;

  if (sepIndex === -1) {
    intPart = cleaned;
    fracPart = "";
  } else {
    const candidateFrac = cleaned.slice(sepIndex + 1);
    // A separator followed by exactly 3 digits and no other separator is a
    // thousands separator ("1.234" = 1234 €), otherwise it's decimal.
    const otherSeparators = cleaned.slice(0, sepIndex).replace(/\d/g, "");
    if (candidateFrac.length === 3 && otherSeparators.length === 0) {
      intPart = cleaned.slice(0, sepIndex) + candidateFrac;
      fracPart = "";
    } else {
      intPart = cleaned.slice(0, sepIndex);
      fracPart = candidateFrac;
    }
  }

  // Integer part must be plain digits or properly grouped thousands.
  if (
    intPart !== "" &&
    !/^\d+$/.test(intPart) &&
    !/^\d{1,3}([.,])\d{3}(\1\d{3})*$/.test(intPart)
  ) {
    return null;
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (fracPart.length > 2 || !/^\d*$/.test(fracPart)) return null;
  if (intPart === "" && fracPart === "") return null;

  const cents =
    Number(intPart || "0") * 100 + Number(fracPart.padEnd(2, "0") || "0");
  return negative ? -cents : cents;
}
