import { requireUser } from "@/lib/auth";
import {
  entryTotals,
  listCategories,
  listBusinessLocations,
  listEntriesPage,
  listPayrollMonthContexts,
  listPersonnelEmployees,
  monthlySummary,
  vatSummary,
  yearsWithEntries,
} from "@/modules/accounting/queries";
import { AccountingOverview } from "@/modules/accounting/components/accounting-overview";
import { getAppSettings } from "@/modules/settings/queries";
import { listFundingProjects } from "@/modules/funding/queries";

function parseYear(value?: string) {
  return value && /^\d{4}$/.test(value)
    ? Number(value)
    : new Date().getFullYear();
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; new?: string }>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const year = parseYear(params.year);
  const canManagePersonnel = user.role === "admin" || user.role === "personnel";
  const filters = { year, includePersonnelDetails: canManagePersonnel };
  const entries = listEntriesPage(filters, { limit: 5 }).items;
  const totals = entryTotals(filters);
  const months = monthlySummary(year);
  const categories = listCategories({ includeArchived: true });
  const vatRows = vatSummary(year);
  const settings = getAppSettings();
  const fundingProjects = listFundingProjects().map(({ id, name }) => ({ id, name }));
  const personnelEmployees = canManagePersonnel ? listPersonnelEmployees() : [];
  const personnelLocations = canManagePersonnel ? listBusinessLocations() : [];
  const payrollMonthContexts = canManagePersonnel ? listPayrollMonthContexts() : [];
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
      openEntryOnLoad={params.new === "expense" || params.new === "income"}
      canManagePersonnel={canManagePersonnel}
      taxSettings={{ kleinunternehmer: settings.kleinunternehmer, defaultVatRate: settings.defaultVatRate }}
      fundingProjects={fundingProjects}
      personnelEmployees={personnelEmployees}
      personnelLocations={personnelLocations}
      payrollMonthContexts={payrollMonthContexts}
    />
  );
}
