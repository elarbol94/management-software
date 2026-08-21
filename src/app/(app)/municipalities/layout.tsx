import { getTranslations } from "next-intl/server";
import { MapPinned } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { MunicipalityAnalysisPersistenceProvider } from "@/modules/municipalities/components/municipality-analysis-persistence-provider";
import { MunicipalitiesSubnav } from "@/modules/municipalities/components/municipalities-subnav";

export default async function MunicipalitiesLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const t = await getTranslations("municipalities");
  return (
    <MunicipalityAnalysisPersistenceProvider>
    <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-4">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-1 hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-teal-100 text-teal-700 sm:flex dark:bg-teal-950 dark:text-teal-300">
            <MapPinned className="size-5" />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-teal-700 uppercase dark:text-teal-300">{t("eyebrow")}</p>
            <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
          </div>
        </div>
        <MunicipalitiesSubnav />
      </header>
      {children}
    </div>
    </MunicipalityAnalysisPersistenceProvider>
  );
}
