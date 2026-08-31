import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Presentation } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listPresentations } from "@/modules/wiki/presentation-queries";
import {
  DeletePresentationButton,
  NewPresentationForm,
} from "@/modules/wiki/components/presentation-list-actions";

export default async function PresentationsPage() {
  const [, t] = await Promise.all([requireUser(), getTranslations("wiki")]);
  const presentations = listPresentations();

  return (
    <div className="p-5 md:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-[0.16em] text-indigo-600 uppercase">{t("researchWorkspace")}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("presentations.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("presentations.description")}</p>
        </div>
        <NewPresentationForm />
      </header>

      {presentations.length === 0 ? (
        <div className="mt-6 grid min-h-64 place-items-center rounded-xl border border-dashed bg-muted/20 text-center">
          <div>
            <Presentation className="mx-auto mb-3 size-8 text-indigo-400" />
            <h2 className="font-medium">{t("presentations.empty")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("presentations.emptyDescription")}</p>
          </div>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {presentations.map((presentation) => (
            <li key={presentation.id} className="group rounded-xl border bg-card p-4 transition-colors hover:border-indigo-300">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/wiki/presentations/${presentation.id}`} className="min-w-0 flex-1">
                  <h2 className="truncate font-medium group-hover:text-indigo-700 dark:group-hover:text-indigo-300">{presentation.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("presentations.stepsCount", { count: presentation.stepCount })} · {t("presentations.elementsCount", { count: presentation.elementCount })}
                  </p>
                </Link>
                <DeletePresentationButton id={presentation.id} title={presentation.title} />
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs">
                <Link href={`/wiki/presentations/${presentation.id}`} className="font-medium text-indigo-600">{t("edit")}</Link>
                <Link href={`/wiki/presentations/${presentation.id}/present`} className="font-medium text-indigo-600">{t("presentations.present")}</Link>
                {presentation.updatedByName && <span className="ml-auto truncate text-muted-foreground">{presentation.updatedByName}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
