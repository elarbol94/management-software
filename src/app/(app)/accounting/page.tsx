import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import {
  entryTotals,
  listCategories,
  listEntries,
  yearsWithEntries,
  type EntryFilters,
} from "@/modules/accounting/queries";
import { LedgerClient } from "@/modules/accounting/components/ledger-client";

function parseFilters(params: {
  year?: string;
  month?: string;
  kind?: string;
  category?: string;
}): EntryFilters {
  const now = new Date();
  const year =
    params.year && /^\d{4}$/.test(params.year)
      ? Number(params.year)
      : now.getFullYear();
  const month =
    params.month && /^\d{1,2}$/.test(params.month)
      ? Math.min(12, Math.max(1, Number(params.month)))
      : undefined;
  const kind =
    params.kind === "income" || params.kind === "expense"
      ? params.kind
      : undefined;
  return { year, month, kind, categoryId: params.category || undefined };
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    month?: string;
    kind?: string;
    category?: string;
  }>;
}) {
  await requireUser();
  const filters = parseFilters(await searchParams);
  const t = await getTranslations("accounting");

  const entries = listEntries(filters);
  const totals = entryTotals(filters);
  const categories = listCategories();
  const years = yearsWithEntries();
  const currentYear = new Date().getFullYear();
  if (!years.includes(currentYear)) years.unshift(currentYear);
  if (!years.includes(filters.year)) years.push(filters.year);
  years.sort((a, b) => b - a);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <LedgerClient
        entries={entries}
        totals={totals}
        categories={categories}
        years={years}
        filters={filters}
      />
    </div>
  );
}
