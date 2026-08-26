import { requireUser } from "@/lib/auth";
import { MunicipalitiesWorkspace } from "@/modules/municipalities/components/municipalities-workspace";
import { listMunicipalityMetricsForUser } from "@/modules/municipalities/queries";

export default async function MunicipalitiesOverviewPage() {
  const user = await requireUser();
  return <MunicipalitiesWorkspace metrics={listMunicipalityMetricsForUser(user.id)} />;
}
