import { formatCentsPlainDe } from "@/lib/money";

// Semicolon-delimited, decimal comma, UTF-8 BOM: opens correctly in
// German-locale Excel, which is what the Steuerberater will use.

export type CsvEntry = {
  id?: string;
  date: string;
  documentDate?: string | null;
  documentNumber?: string;
  status?: "draft" | "finalized" | "voided";
  kind: "income" | "expense";
  description: string;
  counterparty: string;
  categoryName: string;
  paymentMethod: "bank" | "cash" | "card";
  netAmountCents: number;
  vatRate: number;
  vatAmountCents: number;
  grossAmountCents: number;
  notes: string;
  deductiblePercent?: number;
  taxLines?: Array<{
    description: string;
    netAmountCents: number;
    vatRate: number;
    vatAmountCents: number;
    grossAmountCents: number;
    inputVatDeductiblePercent: number;
  }>;
  paymentLines?: Array<{
    date: string;
    description: string;
    recipient: string;
    amountCents: number;
    paymentMethod: "bank" | "cash" | "card";
  }>;
};

const KIND_LABELS = { income: "Einnahme", expense: "Ausgabe" } as const;
const PAYMENT_LABELS = { bank: "Bank", cash: "Bar", card: "Karte" } as const;

const HEADER = [
  "Datum",
  "Art",
  "Beschreibung",
  "Gegenpartei",
  "Kategorie",
  "Zahlungsart",
  "Netto",
  "USt-Satz (%)",
  "USt",
  "Brutto",
  "Notizen",
  "Buchungs-ID",
  "Belegdatum",
  "Belegnummer",
  "Steuerzeile",
  "Vorsteuer abzugsfähig (%)",
  "Betrieblich abzugsfähig (%)",
  "Status",
  "Detailtyp",
  "Zahlungsdatum",
  "Zahlungsempfänger",
  "Zahlungsbeschreibung",
  "Zahlungsbetrag",
  "Zahlungsart Detail",
];

function escapeField(value: string): string {
  if (/[;"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Format ISO date (YYYY-MM-DD) as Austrian DD.MM.YYYY. */
function formatDateDe(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

export function buildEntriesCsv(rows: CsvEntry[]): string {
  const lines = [HEADER.join(";")];
  for (const row of rows) {
    const taxLines = row.taxLines?.length
      ? row.taxLines
      : [{
          description: "",
          netAmountCents: row.netAmountCents,
          vatRate: row.vatRate,
          vatAmountCents: row.vatAmountCents,
          grossAmountCents: row.grossAmountCents,
          inputVatDeductiblePercent: 100,
        }];
    taxLines.forEach((taxLine, index) => {
      lines.push([
        formatDateDe(row.date),
        KIND_LABELS[row.kind],
        escapeField(row.description),
        escapeField(row.counterparty),
        escapeField(row.categoryName),
        PAYMENT_LABELS[row.paymentMethod],
        formatCentsPlainDe(taxLine.netAmountCents),
        String(taxLine.vatRate),
        formatCentsPlainDe(taxLine.vatAmountCents),
        formatCentsPlainDe(taxLine.grossAmountCents),
        escapeField(row.notes),
        row.id ?? "",
        row.documentDate ? formatDateDe(row.documentDate) : "",
        escapeField(row.documentNumber ?? ""),
        escapeField(taxLine.description || String(index + 1)),
        String(taxLine.inputVatDeductiblePercent),
        String(row.deductiblePercent ?? 100),
        row.status ?? "finalized",
        "Steuerzeile",
        "",
        "",
        "",
        "",
        "",
      ].join(";"));
    });
    for (const paymentLine of row.paymentLines ?? []) {
      lines.push([
        formatDateDe(row.date),
        KIND_LABELS[row.kind],
        escapeField(row.description),
        escapeField(row.counterparty),
        escapeField(row.categoryName),
        PAYMENT_LABELS[row.paymentMethod],
        "",
        "",
        "",
        "",
        escapeField(row.notes),
        row.id ?? "",
        row.documentDate ? formatDateDe(row.documentDate) : "",
        escapeField(row.documentNumber ?? ""),
        "",
        "",
        String(row.deductiblePercent ?? 100),
        row.status ?? "finalized",
        "Zahlung",
        formatDateDe(paymentLine.date),
        escapeField(paymentLine.recipient),
        escapeField(paymentLine.description),
        formatCentsPlainDe(paymentLine.amountCents),
        PAYMENT_LABELS[paymentLine.paymentMethod],
      ].join(";"));
    }
  }
  // BOM so Excel detects UTF-8; CRLF line endings for Windows Excel.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
