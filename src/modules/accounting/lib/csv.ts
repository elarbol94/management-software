import { formatCentsPlainDe } from "@/lib/money";

// Semicolon-delimited, decimal comma, UTF-8 BOM: opens correctly in
// German-locale Excel, which is what the Steuerberater will use.

export type CsvEntry = {
  date: string;
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
    lines.push(
      [
        formatDateDe(row.date),
        KIND_LABELS[row.kind],
        escapeField(row.description),
        escapeField(row.counterparty),
        escapeField(row.categoryName),
        PAYMENT_LABELS[row.paymentMethod],
        formatCentsPlainDe(row.netAmountCents),
        String(row.vatRate),
        formatCentsPlainDe(row.vatAmountCents),
        formatCentsPlainDe(row.grossAmountCents),
        escapeField(row.notes),
      ].join(";"),
    );
  }
  // BOM so Excel detects UTF-8; CRLF line endings for Windows Excel.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
