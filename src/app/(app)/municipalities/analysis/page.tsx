import { requireUser } from "@/lib/auth";
import { MunicipalityAnalysisClient } from "@/modules/municipalities/components/municipality-analysis-client";
import { getMunicipalityAnalysisForUser, listMunicipalityAnalysesForUser } from "@/modules/municipalities/queries";

export default async function MunicipalitiesAnalysisPage({ searchParams }: { searchParams: Promise<{ analysis?: string }> }) {
  const user = await requireUser();
  const query = await searchParams;
  const analyses = listMunicipalityAnalysesForUser(user.id);
  const active = typeof query.analysis === "string" ? getMunicipalityAnalysisForUser(query.analysis, user.id) : null;
  return <MunicipalityAnalysisClient analyses={analyses} initialAnalysis={active} />;
}
