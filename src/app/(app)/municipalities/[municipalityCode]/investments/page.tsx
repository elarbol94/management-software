import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadMunicipalityInvestmentData } from "@/modules/municipalities/investment-data.server";
import { MunicipalityInvestmentsClient } from "@/modules/municipalities/components/municipality-investments-client";

export default async function MunicipalityInvestmentsPage({
  params,
}: {
  params: Promise<{ municipalityCode: string }>;
}) {
  await requireUser();
  const { municipalityCode } = await params;
  const data = await loadMunicipalityInvestmentData(municipalityCode);
  if (!data) notFound();
  return <MunicipalityInvestmentsClient data={data} />;
}
