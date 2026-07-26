import { getLocale } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { getPersonnelWorkspace } from "@/modules/personnel/queries";
import { PersonnelWorkspace } from "@/modules/personnel/components/personnel-workspace";

export default async function PersonnelPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const viewer = await requireUser();
  const params = await searchParams;
  const requestedYear = Number(params.year);
  const year = [2025, 2026, 2027].includes(requestedYear) ? requestedYear : 2026;
  const data = getPersonnelWorkspace(viewer, year);
  const locale = await getLocale();
  return <PersonnelWorkspace data={data} locale={locale} />;
}
