import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import {
  entryTotals,
  listBusinessLocations,
  listCategories,
  listEntriesPage,
  listPersonnelEmployees,
  listPayrollMonthContexts,
  yearsWithEntries,
  type EntryFilters,
} from "@/modules/accounting/queries";
import { LedgerClient } from "@/modules/accounting/components/ledger-client";
import { getAppSettings } from "@/modules/settings/queries";
import { listFundingProjects } from "@/modules/funding/queries";

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

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string;
    month?: string;
    kind?: string;
    category?: string;
    cursor?: string;
  }>;
}) {
  const [user, params, t] = await Promise.all([
    requireUser(),
    searchParams,
    getTranslations("accountingBookings"),
  ]);
  const filters = {
    ...parseFilters(params),
    includePersonnelDetails: user.role === "admin" || user.role === "personnel",
  };
  const entryPage = listEntriesPage(filters, { cursor: params.cursor, limit: 50 });
  const totals = entryTotals(filters);
  const categories = listCategories();
  const years = yearsWithEntries();
  const currentYear = new Date().getFullYear();
  const settings = getAppSettings();
  const fundingProjects = listFundingProjects().map(({ id, name }) => ({ id, name }));
  const personnelEmployees = filters.includePersonnelDetails ? listPersonnelEmployees() : [];
  const personnelLocations = filters.includePersonnelDetails ? listBusinessLocations() : [];
  const payrollMonthContexts = filters.includePersonnelDetails ? listPayrollMonthContexts() : [];
  if (!years.includes(currentYear)) years.unshift(currentYear);
  if (!years.includes(filters.year)) years.push(filters.year);
  years.sort((a, b) => b - a);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-[#71807a] uppercase">
          {t("eyebrow")}
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[#15342c] sm:text-[2.35rem] sm:leading-tight">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#65736e] sm:text-base">
          {t("description")}
        </p>
      </div>
      <LedgerClient
        entries={entryPage.items}
        nextCursor={entryPage.nextCursor}
        totals={totals}
        categories={categories}
        years={years}
        filters={filters}
        canManagePersonnel={filters.includePersonnelDetails}
        taxSettings={{ kleinunternehmer: settings.kleinunternehmer, defaultVatRate: settings.defaultVatRate }}
        fundingProjects={fundingProjects}
        personnelEmployees={personnelEmployees}
        personnelLocations={personnelLocations}
        payrollMonthContexts={payrollMonthContexts}
      />
    </div>
  );
}
