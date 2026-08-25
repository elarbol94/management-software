"use client";

import { ExternalLink, Layers3 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  DIGITAL_PLATFORM_KINDS,
  type DigitalPlatformKind,
  type MunicipalityDigitalPlatformProfile,
} from "../digital-platforms";

export function MunicipalityDigitalPlatformsPanel({
  profile,
  referenceDate,
}: {
  profile: MunicipalityDigitalPlatformProfile;
  referenceDate: string;
}) {
  const t = useTranslations("municipalities");
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const number = new Intl.NumberFormat(locale);
  const kindLabels: Record<DigitalPlatformKind, string> = {
    "appointment-booking": t("digitalKindAppointmentBooking"),
    "citizen-app": t("digitalKindCitizenApp"),
    "digital-notice-board": t("digitalKindNoticeBoard"),
    "issue-reporting": t("digitalKindIssueReporting"),
    messaging: t("digitalKindMessaging"),
    "official-website": t("digitalKindOfficialWebsite"),
    "open-data": t("digitalKindOpenData"),
    other: t("digitalKindOther"),
    participation: t("digitalKindParticipation"),
    "service-portal": t("digitalKindServicePortal"),
    "social-media": t("digitalKindSocialMedia"),
    "waste-platform": t("digitalKindWastePlatform"),
    "website-cms": t("digitalKindWebsiteCms"),
  };
  const platforms = profile.platforms
    .filter(({ kind }) => kind !== "official-website")
    .toSorted((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.name.localeCompare(b.name, locale));
  const groups = DIGITAL_PLATFORM_KINDS.flatMap((kind) => {
    if (kind === "official-website") return [];
    const items = platforms.filter((platform) => platform.kind === kind);
    return items.length ? [{ kind, items }] : [];
  });

  return (
    <section className="rounded-xl border bg-card p-4" data-testid="municipality-digital-platforms-panel">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <Layers3 className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold">{t("digitalProfileTitle")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {platforms.length
              ? t("digitalProfileSummary", { platforms: platforms.length, areas: groups.length })
              : t("digitalProfileNoneFound")}
          </p>
        </div>
      </div>

      {groups.length ? (
        <div className="mt-4 divide-y rounded-lg border">
          {groups.map(({ kind, items }) => (
            <details key={kind} className="group px-3 py-2 first:rounded-t-lg last:rounded-b-lg" open={groups.length <= 3}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                <span>{kindLabels[kind]}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {number.format(items.length)}
                </span>
              </summary>
              <ul className="mt-2 space-y-2 border-t pt-2">
                {items.map((platform) => (
                  <li key={platform.id} className="text-xs">
                    <a
                      href={platform.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-start gap-1 font-medium text-teal-700 underline underline-offset-2 hover:text-teal-800 dark:text-teal-300"
                    >
                      <span>{platform.name}</span>
                      <ExternalLink className="mt-0.5 size-3 shrink-0" />
                    </a>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                      {platform.provider ? `${platform.provider} · ` : ""}
                      {platform.status === "active" ? t("digitalStatusActive") : t("digitalStatusUnclear")}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
        {t("digitalProfileReference", { date: date.format(new Date(`${referenceDate}T00:00:00`)) })}
        {profile.researchStatus === "partial" ? ` · ${t("digitalProfilePartial")}` : ""}
      </p>
    </section>
  );
}
