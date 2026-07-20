import { requireUser } from "@/lib/auth";
import {
  entryTotals,
  listCategories,
  listEntries,
  monthlySummary,
  vatSummary,
  yearsWithEntries,
} from "@/modules/accounting/queries";
import { AccountingOverview } from "@/modules/accounting/components/accounting-overview";

function parseYear(value?: string) {
  return value && /^\d{4}$/.test(value)
    ? Number(value)
    : new Date().getFullYear();
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireUser();
  const year = parseYear((await searchParams).year);
  const filters = { year };
  const entries = listEntries(filters);
  const totals = entryTotals(filters);
  const months = monthlySummary(year);
  const categories = listCategories();
  const vatRows = vatSummary(year);
  const vatCollected = vatRows
    .filter((row) => row.kind === "income")
    .reduce((sum, row) => sum + row.vat, 0);
  const vatPaid = vatRows
    .filter((row) => row.kind === "expense")
    .reduce((sum, row) => sum + row.vat, 0);

  const years = yearsWithEntries();
  const currentYear = new Date().getFullYear();
  if (!years.includes(currentYear)) years.unshift(currentYear);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => b - a);

  return (
    <AccountingOverview
      entries={entries}
      months={months}
      totals={totals}
      vatBalance={vatCollected - vatPaid}
      categories={categories}
      years={years}
      year={year}
    />
  );
}
