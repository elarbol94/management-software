import { requireUser } from "@/lib/auth";
import {
  entryTotals,
  listCategories,
  listBusinessLocations,
  listEntries,
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
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await requireUser();
  const year = parseYear((await searchParams).year);
  const canManagePersonnel = user.role === "admin" || user.role === "personnel";
  const filters = { year, includePersonnelDetails: canManagePersonnel };
  const entries = listEntries(filters);
  const totals = entryTotals(filters);
  const months = monthlySummary(year);
  const categories = listCategories();
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
      canManagePersonnel={canManagePersonnel}
      taxSettings={{ kleinunternehmer: settings.kleinunternehmer, defaultVatRate: settings.defaultVatRate }}
      fundingProjects={fundingProjects}
      personnelEmployees={personnelEmployees}
      personnelLocations={personnelLocations}
      payrollMonthContexts={payrollMonthContexts}
    />
  );
}
