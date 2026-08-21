import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadMunicipalityInvestmentData } from "@/modules/municipalities/investment-data.server";
import { MunicipalityInvestmentsClient, type InitialInvestmentFilters } from "@/modules/municipalities/components/municipality-investments-client";
import { INVESTMENT_TASK_AREAS, INVESTMENT_TYPES } from "@/modules/municipalities/investments";

export default async function MunicipalityInvestmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ municipalityCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const { municipalityCode } = await params;
  const data = await loadMunicipalityInvestmentData(municipalityCode);
  if (!data) notFound();
  const query = await searchParams;
  const pick = (key: string) => typeof query[key] === "string" ? query[key] : undefined;
  const requestedYear = pick("year");
  const requestedTask = pick("task");
  const requestedType = pick("type");
  const requestedMinimum = pick("min");
  const requestedQuery = pick("q");
  const initialFilters: InitialInvestmentFilters = {
    year: requestedYear === "all" || data.availableYears.includes(Number(requestedYear)) ? requestedYear : undefined,
    taskArea: requestedTask === "all" || INVESTMENT_TASK_AREAS.some(({ id }) => id === requestedTask) ? requestedTask : undefined,
    investmentType: requestedType === "all" || INVESTMENT_TYPES.some(({ id }) => id === requestedType) ? requestedType : undefined,
    minimum: requestedMinimum && /^\d+(?:[.,]\d{1,2})?$/.test(requestedMinimum) ? requestedMinimum : undefined,
    query: requestedQuery?.slice(0, 200),
  };
  return <MunicipalityInvestmentsClient data={data} initialFilters={initialFilters} />;
}
