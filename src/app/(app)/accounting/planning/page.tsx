import Link from "next/link";
import { ArrowLeft } from "@/components/server-safe-icons";
import { getLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import {
  planningOverview,
  yearsWithEntries,
  yearsWithPlans,
} from "@/modules/accounting/queries";
import { PlanningClient } from "@/modules/accounting/components/planning-client";
import { Button } from "@/components/ui/button";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const year =
    params.year && /^\d{4}$/.test(params.year)
      ? Number(params.year)
      : new Date().getFullYear();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const rows = planningOverview(year);
  const currentYear = new Date().getFullYear();
  const years = [
    ...new Set([
      currentYear - 1,
      currentYear,
      currentYear + 1,
      year,
      ...yearsWithEntries(),
      ...yearsWithPlans(),
    ]),
  ].sort((a, b) => b - a);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/accounting" />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("planning")} {year}
        </h1>
      </div>
      <PlanningClient key={year} rows={rows} year={year} years={years} locale={locale} />
    </div>
  );
}
