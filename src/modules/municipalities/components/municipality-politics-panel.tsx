"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { POLITICS_PARTY_COLORS } from "../palette";
import type { MunicipalityCurrentPolitics, MunicipalityElectionEvent, PoliticsSource } from "../politics";

function SourceLinks({ ids, sources }: { ids: string[]; sources: PoliticsSource[] }) {
  const links = ids.flatMap((id) => {
    const source = sources.find((item) => item.id === id);
    return source ? [source] : [];
  });
  if (!links.length) return null;
  return <span>{links.map((source, index) => <span key={source.id}>{index ? ", " : ""}<a className="text-teal-700 underline underline-offset-2" href={source.url} target="_blank" rel="noreferrer">{source.title}</a></span>)}</span>;
}

const HEMICYCLE_CENTER_X = 110;
const HEMICYCLE_CENTER_Y = 104;
const HEMICYCLE_OUTER_RADIUS = 92;
const HEMICYCLE_INNER_RADIUS = 52;

function polarPoint(radius: number, angle: number) {
  return {
    x: HEMICYCLE_CENTER_X + radius * Math.cos(angle),
    y: HEMICYCLE_CENTER_Y + radius * Math.sin(angle),
  };
}

function hemicyclePath(startAngle: number, endAngle: number) {
  const outerStart = polarPoint(HEMICYCLE_OUTER_RADIUS, startAngle);
  const outerEnd = polarPoint(HEMICYCLE_OUTER_RADIUS, endAngle);
  const innerEnd = polarPoint(HEMICYCLE_INNER_RADIUS, endAngle);
  const innerStart = polarPoint(HEMICYCLE_INNER_RADIUS, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${HEMICYCLE_OUTER_RADIUS} ${HEMICYCLE_OUTER_RADIUS} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${HEMICYCLE_INNER_RADIUS} ${HEMICYCLE_INNER_RADIUS} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function CouncilHemicycle({ event }: { event: MunicipalityElectionEvent }) {
  const t = useTranslations("municipalities");
  const number = new Intl.NumberFormat(useLocale());
  const [activeListKey, setActiveListKey] = useState<string | null>(null);
  const lists = event.lists
    .filter((list) => list.mandates !== null && list.mandates > 0)
    .toSorted((a, b) => (b.mandates ?? 0) - (a.mandates ?? 0) || b.votes - a.votes);
  const complete = lists.length > 0 && event.lists.every((list) => list.mandates !== null);
  const totalMandates = lists.reduce((sum, list) => sum + (list.mandates ?? 0), 0);

  if (!complete || totalMandates === 0) return null;

  const segments = lists.map((list, index) => {
    const key = `${list.party}-${list.name}`;
    const usedMandates = lists.slice(0, index).reduce((sum, previous) => sum + (previous.mandates ?? 0), 0);
    const startAngle = -Math.PI + (usedMandates / totalMandates) * Math.PI;
    const endAngle = -Math.PI + ((usedMandates + (list.mandates ?? 0)) / totalMandates) * Math.PI;
    const gap = lists.length > 1 ? 0.012 : 0;
    return { key, list, path: hemicyclePath(startAngle + gap, endAngle - gap) };
  });
  const activeList = segments.find(({ key }) => key === activeListKey)?.list ?? null;
  const describe = (list: (typeof lists)[number]) => `${list.name}: ${t("politicsMandates", { count: list.mandates ?? 0 })}, ${number.format(list.votes)} ${t("politicsVoters")}`;

  return (
    <div className="relative mt-2" data-testid="politics-seat-distribution">
      {activeList ? (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 min-w-36 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-center text-xs shadow-md" role="tooltip" data-testid="politics-seat-tooltip">
          <p className="font-semibold">{activeList.name}</p>
          <p className="mt-0.5 text-muted-foreground">{t("politicsMandates", { count: activeList.mandates ?? 0 })} · {number.format(activeList.votes)} {t("politicsVoters")}</p>
        </div>
      ) : null}
      <svg viewBox="0 0 220 110" className="mx-auto block w-full max-w-60" role="img" aria-label={t("politicsSeatDistributionLabel")}>
        {segments.map(({ key, list, path }) => (
          <path
            key={key}
            d={path}
            fill={POLITICS_PARTY_COLORS[list.party]}
            className="cursor-help stroke-card transition-opacity hover:opacity-80 focus:opacity-80 focus:outline-none"
            strokeWidth="2"
            tabIndex={0}
            aria-label={describe(list)}
            onMouseEnter={() => setActiveListKey(key)}
            onMouseLeave={() => setActiveListKey(null)}
            onFocus={() => setActiveListKey(key)}
            onBlur={() => setActiveListKey(null)}
          >
            <title>{describe(list)}</title>
          </path>
        ))}
      </svg>
    </div>
  );
}

function Council({ event }: { event: MunicipalityElectionEvent }) {
  const t = useTranslations("municipalities");
  const number = new Intl.NumberFormat(useLocale());
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">{t("politicsElectionDate", { date: event.date })}</p>
      <CouncilHemicycle event={event} />
      <ul className="space-y-1.5">
        {event.lists.toSorted((a, b) => (b.mandates ?? -1) - (a.mandates ?? -1) || b.votes - a.votes).map((list) => (
          <li key={`${list.party}-${list.name}`} className="flex items-start justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-start gap-2"><span className="mt-0.5 size-2.5 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: POLITICS_PARTY_COLORS[list.party] }} /><span>{list.name}</span></span>
            <span className="shrink-0 font-semibold tabular-nums">{list.mandates === null ? t("politicsMandatesUnavailable") : t("politicsMandates", { count: list.mandates })} · {number.format(list.votes)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-4 text-muted-foreground">{t("politicsCouncilDisclaimer")}</p>
      {event.aggregationStatus === "aggregated-predecessors" ? <p className="text-[11px] text-amber-700 dark:text-amber-300">{t("politicsAggregated")}</p> : null}
    </div>
  );
}

export function MunicipalityPoliticsPanel({ current, currentSources, history, historySources, loadingHistory, historyError, onOpenHistory }: {
  current: MunicipalityCurrentPolitics | null;
  currentSources: PoliticsSource[];
  history: MunicipalityElectionEvent[] | null;
  historySources: PoliticsSource[];
  loadingHistory: boolean;
  historyError: boolean;
  onOpenHistory: () => void;
}) {
  const t = useTranslations("municipalities");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <section className="rounded-xl border bg-card p-4" data-testid="municipality-politics-panel">
      <h3 className="font-semibold">{t("politicsProfileTitle")}</h3>
      <div className="mt-3 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("mayor")}</p>
        {current?.mayor ? <><p className="mt-1 font-medium">{current.mayor.name} · {current.mayor.party ? t(`politicsParty${current.mayor.party}` as "politicsPartyoevp") : t("politicsPartyUnavailable")}</p><p className="mt-1 text-xs text-muted-foreground">{current.mayorAsOf ? t("politicsAsOf", { date: current.mayorAsOf }) : null} <SourceLinks ids={current.mayorSourceIds} sources={currentSources} /></p></> : <p className="mt-1 text-muted-foreground">{t("politicsOfficialCoverageMissing")}</p>}
      </div>
      <div className="mt-4 border-t pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("politicsLatestCouncil")}</p>
        {current?.latestCouncil ? <Council event={current.latestCouncil} /> : <p className="mt-1 text-sm text-muted-foreground">{t("politicsOfficialCoverageMissing")}</p>}
      </div>
      <details className="mt-4 border-t pt-4" onToggle={(event) => { if (event.currentTarget.open) onOpenHistory(); }}>
        <summary className="cursor-pointer text-sm font-semibold">{t("politicsHistoryTitle")}</summary>
        {loadingHistory ? <p className="mt-3 text-sm text-muted-foreground">{t("politicsLoading")}</p> : historyError ? <p className="mt-3 text-sm text-destructive" role="alert">{t("politicsLoadError")}</p> : history?.length ? (
          <div className="mt-3 space-y-4">
            {history.toSorted((a, b) => b.date.localeCompare(a.date)).map((event) => (
              <article key={event.id} className="rounded-lg bg-muted/40 p-3">
                <h4 className="text-sm font-semibold">{event.date}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{event.eligibleVoters && event.ballotsCast !== null ? t("politicsTurnoutValue", { value: percent.format(event.ballotsCast / event.eligibleVoters) }) : t("politicsTurnoutMissing")}</p>
                <Council event={event} />
                <p className="mt-2 text-[11px] text-muted-foreground"><SourceLinks ids={event.sourceIds} sources={historySources} /></p>
                {event.mayorCandidates.length ? (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("politicsMayorElection")}</p>
                    <ul className="mt-2 space-y-1.5">
                      {event.mayorCandidates.toSorted((a, b) => a.round - b.round || b.votes - a.votes).map((candidate) => (
                        <li key={`${candidate.round}-${candidate.name}`} className="flex items-start justify-between gap-3 text-xs">
                          <span>{candidate.name}{candidate.listName ? ` · ${candidate.listName}` : ""}{candidate.elected ? ` · ${t("politicsElected")}` : ""}</span>
                          <span className="shrink-0 tabular-nums">{t("politicsElectionRound", { round: candidate.round })} · {number.format(candidate.votes)} {t("politicsVotes")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-muted-foreground">{t("politicsOfficialCoverageMissing")}</p>}
      </details>
    </section>
  );
}
