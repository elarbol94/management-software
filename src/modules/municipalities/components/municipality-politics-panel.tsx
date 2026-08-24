"use client";

import { useLocale, useTranslations } from "next-intl";
import type { MunicipalityCurrentPolitics, MunicipalityElectionEvent, PoliticsSource } from "../politics";

function SourceLinks({ ids, sources }: { ids: string[]; sources: PoliticsSource[] }) {
  const links = ids.flatMap((id) => {
    const source = sources.find((item) => item.id === id);
    return source ? [source] : [];
  });
  if (!links.length) return null;
  return <span>{links.map((source, index) => <span key={source.id}>{index ? ", " : ""}<a className="text-teal-700 underline underline-offset-2" href={source.url} target="_blank" rel="noreferrer">{source.title}</a></span>)}</span>;
}

function Council({ event }: { event: MunicipalityElectionEvent }) {
  const t = useTranslations("municipalities");
  const number = new Intl.NumberFormat(useLocale());
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">{t("politicsElectionDate", { date: event.date })}</p>
      <ul className="space-y-1.5">
        {event.lists.toSorted((a, b) => (b.mandates ?? -1) - (a.mandates ?? -1) || b.votes - a.votes).map((list) => (
          <li key={`${list.party}-${list.name}`} className="flex items-start justify-between gap-3 text-xs">
            <span>{list.name}</span>
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
