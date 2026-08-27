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
    {/* The analysis editor is a canvas, not a document: from lg on it takes the rest of
        the viewport instead of sitting in a fixed box the page scrolls past. Expressed the
        same way the app shell handles project focus mode — a :has() rule — so the overview
        and the analysis landing page keep their normal flow height. */}
    <style>{`
      @media (min-width: 1024px) {
        [data-municipalities-shell]:has([data-analysis-editor]) {
          height: calc(100dvh - 3rem);
        }
        [data-municipalities-shell]:has([data-analysis-editor]) > [data-municipalities-body] {
          flex: 1;
          min-height: 0;
        }
      }
    `}</style>
    <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-2 sm:gap-4" data-municipalities-shell>
      <header className="flex items-center justify-between gap-3 xl:items-end">
        <div className="flex items-start gap-3">
          <div className="mt-1 hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-teal-100 text-teal-700 sm:flex dark:bg-teal-950 dark:text-teal-300">
            <MapPinned className="size-5" />
          </div>
          <div>
            <p className="hidden text-xs font-semibold tracking-[0.16em] text-teal-700 uppercase sm:block dark:text-teal-300">{t("eyebrow")}</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">{t("title")}</h1>
            <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground md:block">{t("description")}</p>
          </div>
        </div>
        <MunicipalitiesSubnav />
      </header>
      <div className="min-w-0" data-municipalities-body>{children}</div>
    </div>
    </MunicipalityAnalysisPersistenceProvider>
  );
}
