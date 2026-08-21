"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ArrowLeft, Database, Download, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  INVESTMENT_TASK_AREAS,
  INVESTMENT_TYPES,
  type InvestmentTaskAreaId,
  type InvestmentTypeId,
  type MunicipalityInvestmentData,
  type MunicipalityInvestmentPosition,
} from "../investments";

type SortKey = "year" | "description" | "amount";

export function MunicipalityInvestmentsClient({ data }: { data: MunicipalityInvestmentData }) {
  const t = useTranslations("municipalityInvestments");
  const locale = useLocale();
  const defaultYear = data.availableYears.includes(2024) ? "2024" : String(data.availableYears.at(-1));
  const [year, setYear] = useState(defaultYear);
  const [taskArea, setTaskArea] = useState("all");
  const [investmentType, setInvestmentType] = useState("all");
  const [minimum, setMinimum] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("amount");
  const [direction, setDirection] = useState<-1 | 1>(-1);
  const currency = useMemo(() => new Intl.NumberFormat(locale, {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }), [locale]);
  const exactCurrency = useMemo(() => new Intl.NumberFormat(locale, {
    style: "currency", currency: "EUR",
  }), [locale]);
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const taskLabels = Object.fromEntries(INVESTMENT_TASK_AREAS.map(({ id }) => [
    id, t(`taskArea${id}` as "taskArea0"),
  ])) as Record<InvestmentTaskAreaId, string>;
  const typeLabels = Object.fromEntries(INVESTMENT_TYPES.map(({ id }) => [
    id, t(`investmentType${id}` as "investmentType3411"),
  ])) as Record<InvestmentTypeId, string>;

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const minimumCents = (Number(minimum.replace(",", ".")) || 0) * 100;
    return data.positions.filter((position) => (
      (year === "all" || position.year === Number(year))
      && (taskArea === "all" || position.taskArea === taskArea)
      && (investmentType === "all" || position.investmentType === investmentType)
      && Math.abs(position.amountCents) >= minimumCents
      && (!normalizedQuery || [position.approachText, position.accountText, position.projectCode,
        position.approachCode, position.accountCode].join(" ").toLocaleLowerCase(locale).includes(normalizedQuery))
    ));
  }, [data.positions, investmentType, locale, minimum, query, taskArea, year]);

  const trendPositions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const minimumCents = (Number(minimum.replace(",", ".")) || 0) * 100;
    return data.positions.filter((position) => (
      (taskArea === "all" || position.taskArea === taskArea)
      && (investmentType === "all" || position.investmentType === investmentType)
      && Math.abs(position.amountCents) >= minimumCents
      && (!normalizedQuery || [position.approachText, position.accountText, position.projectCode,
        position.approachCode, position.accountCode].join(" ").toLocaleLowerCase(locale).includes(normalizedQuery))
    ));
  }, [data.positions, investmentType, locale, minimum, query, taskArea]);

  const sorted = useMemo(() => [...filtered].sort((left, right) => {
    const result = sort === "year" ? left.year - right.year
      : sort === "amount" ? left.amountCents - right.amountCents
        : `${left.approachText} ${left.accountText}`.localeCompare(`${right.approachText} ${right.accountText}`, locale);
    return result * direction;
  }), [direction, filtered, locale, sort]);
  const grouped = useMemo(() => sorted.reduce<Array<{ id: InvestmentTaskAreaId; positions: MunicipalityInvestmentPosition[] }>>(
    (groups, position) => {
      const group = groups.find(({ id }) => id === position.taskArea);
      if (group) group.positions.push(position);
      else groups.push({ id: position.taskArea, positions: [position] });
      return groups;
    },
    [],
  ), [sorted]);
  const selectedYears = year === "all" ? data.years : data.years.filter((entry) => entry.year === Number(year));
  const directInvestmentCents = filtered.reduce((sum, position) => sum + position.amountCents, 0);
  const investiveInflowsCents = selectedYears.reduce((sum, entry) => sum + entry.investiveInflowsCents, 0);
  const investiveBalanceCents = selectedYears.reduce((sum, entry) => sum + entry.investiveBalanceCents, 0);
  const byYear = data.availableYears.map((entryYear) => ({
    year: entryYear,
    value: trendPositions.filter((position) => position.year === entryYear).reduce((sum, position) => sum + position.amountCents, 0),
  }));
  const byTask = INVESTMENT_TASK_AREAS.map(({ id }) => ({
    id,
    value: filtered.filter((position) => position.taskArea === id).reduce((sum, position) => sum + position.amountCents, 0),
  })).filter(({ value }) => value !== 0).sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const maximumYear = Math.max(1, ...byYear.map(({ value }) => Math.abs(value)));
  const maximumTask = Math.max(1, ...byTask.map(({ value }) => Math.abs(value)));

  function updateSort(next: SortKey) {
    if (sort === next) setDirection((value) => value === 1 ? -1 : 1);
    else { setSort(next); setDirection(next === "description" ? 1 : -1); }
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm md:flex-row md:items-end md:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-3" render={<Link href={`/municipalities/overview?municipality=${data.municipality.code}`} />}>
            <ArrowLeft className="size-4" />{t("back")}
          </Button>
          <p className="text-xs font-semibold tracking-[0.16em] text-teal-700 uppercase dark:text-teal-300">{t("eyebrow")}</p>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight">{data.municipality.name}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">{data.municipality.state}</Badge>
            <Badge variant="outline">{data.municipality.code}</Badge>
            <Badge variant="outline">{data.availableYears[0]}–{data.availableYears.at(-1)}</Badge>
          </div>
        </div>
        <Button render={<a href={`/api/municipalities/${data.municipality.code}/investments/export`} />}>
          <Download className="size-4" />{t("downloadHtml")}
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("summary")}> 
        {[
          [t("directInvestments"), currency.format(directInvestmentCents / 100)],
          [t("positions"), integer.format(filtered.length)],
          [t("investiveInflows"), currency.format(investiveInflowsCents / 100)],
          [t("investiveBalance"), currency.format(investiveBalanceCents / 100)],
        ].map(([label, value]) => (
          <Card key={label}><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-2xl tabular-nums">{value}</CardTitle></CardHeader></Card>
        ))}
      </section>

      <Card>
        <CardContent className="grid gap-3 pt-1 sm:grid-cols-2 xl:grid-cols-5">
          <Filter label={t("year")}>
            <select className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={year} onChange={(event) => setYear(event.target.value)}>
              <option value="all">{t("allYears")}</option>
              {[...data.availableYears].reverse().map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </Filter>
          <Filter label={t("taskArea")}>
            <select className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={taskArea} onChange={(event) => setTaskArea(event.target.value)}>
              <option value="all">{t("allTaskAreas")}</option>
              {INVESTMENT_TASK_AREAS.map(({ id }) => <option key={id} value={id}>{taskLabels[id]}</option>)}
            </select>
          </Filter>
          <Filter label={t("investmentType")}>
            <select className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={investmentType} onChange={(event) => setInvestmentType(event.target.value)}>
              <option value="all">{t("allInvestmentTypes")}</option>
              {INVESTMENT_TYPES.map(({ id }) => <option key={id} value={id}>{typeLabels[id]}</option>)}
            </select>
          </Filter>
          <Filter label={t("minimum")}><Input type="number" min="0" step="100" value={minimum} onValueChange={setMinimum} /></Filter>
          <Filter label={t("search")}>
            <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input className="pl-9" type="search" value={query} onValueChange={setQuery} placeholder={t("searchPlaceholder")} /></div>
          </Filter>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <BreakdownCard title={t("trend")} rows={byYear.map(({ year: itemYear, value }) => ({ label: String(itemYear), value }))} maximum={maximumYear} currency={currency} empty={t("noResults")} />
        <BreakdownCard title={t("breakdown")} rows={byTask.map(({ id, value }) => ({ label: taskLabels[id], value }))} maximum={maximumTask} currency={currency} empty={t("noResults")} />
      </div>

      <Card>
        <CardHeader><CardTitle>{t("details")}</CardTitle><CardDescription>{t("resultCount", { count: filtered.length })}</CardDescription></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[72rem] border-collapse text-sm">
              <thead className="bg-muted/70 text-left text-xs text-muted-foreground">
                <tr>
                  <SortableHeader label={t("year")} onClick={() => updateSort("year")} />
                  <th className="px-3 py-2.5">{t("taskArea")}</th>
                  <SortableHeader label={t("descriptionLabel")} onClick={() => updateSort("description")} />
                  <th className="px-3 py-2.5">{t("investmentType")}</th>
                  <th className="px-3 py-2.5">{t("projectCode")}</th>
                  <th className="px-3 py-2.5">{t("sourceDetail")}</th>
                  <SortableHeader label={t("amount")} onClick={() => updateSort("amount")} align="right" />
                </tr>
              </thead>
              <tbody>
                {grouped.map((group) => (
                  <GroupRows key={group.id} group={group} taskLabels={taskLabels} typeLabels={typeLabels} exactCurrency={exactCurrency} t={t} />
                ))}
              </tbody>
            </table>
            {!filtered.length && <p className="p-8 text-center text-sm text-muted-foreground">{t("noResults")}</p>}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/25">
        <CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-4" />{t("methodology")}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm leading-6 text-muted-foreground">
          <p>{t("methodologyText")}</p>
          <p>{t("source")}: <a className="underline underline-offset-2" href={data.source.url} target="_blank" rel="noreferrer">{data.source.title}</a> · <a className="underline underline-offset-2" href={data.source.definitionUrl} target="_blank" rel="noreferrer">VRV 2015</a></p>
          <p className="text-xs">{data.years.map((entry) => `${entry.year}: ${entry.statisticsFile}${entry.municipalityFile ? ` + ${entry.municipalityFile}` : ""}`).join(" · ")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground"><span>{label}</span>{children}</label>;
}

function BreakdownCard({ title, rows, maximum, currency, empty }: {
  title: string; rows: Array<{ label: string; value: number }>; maximum: number; currency: Intl.NumberFormat; empty: string;
}) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent className="space-y-3">
    {rows.length ? rows.map((row) => <div key={row.label} className="grid grid-cols-[minmax(7rem,1fr)_minmax(7rem,2fr)_auto] items-center gap-3 text-xs">
      <span className="truncate" title={row.label}>{row.label}</span><span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${row.value < 0 ? "bg-red-500" : "bg-teal-600"}`} style={{ width: `${Math.max(1, Math.abs(row.value) / maximum * 100)}%` }} /></span><strong className="tabular-nums">{currency.format(row.value / 100)}</strong>
    </div>) : <p className="text-sm text-muted-foreground">{empty}</p>}
  </CardContent></Card>;
}

function SortableHeader({ label, onClick, align = "left" }: { label: string; onClick: () => void; align?: "left" | "right" }) {
  return <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""}`}><button className="font-semibold hover:text-foreground" onClick={onClick}>{label} ↕</button></th>;
}

function GroupRows({ group, taskLabels, typeLabels, exactCurrency, t }: {
  group: { id: InvestmentTaskAreaId; positions: MunicipalityInvestmentPosition[] };
  taskLabels: Record<InvestmentTaskAreaId, string>;
  typeLabels: Record<InvestmentTypeId, string>;
  exactCurrency: Intl.NumberFormat;
  t: ReturnType<typeof useTranslations<"municipalityInvestments">>;
}) {
  return <>
    <tr className="border-t bg-muted/35"><td colSpan={7} className="px-3 py-2 font-semibold">{taskLabels[group.id]}</td></tr>
    {group.positions.map((position) => <tr key={position.id} className="border-t align-top">
      <td className="px-3 py-3 tabular-nums">{position.year}</td>
      <td className="px-3 py-3">{taskLabels[position.taskArea]}<span className="mt-1 block font-mono text-[11px] text-muted-foreground">{position.approachCode}</span></td>
      <td className="px-3 py-3"><span className="font-medium">{position.approachText || "—"}</span>{position.accountText && <span className="mt-1 block text-xs text-muted-foreground">{position.accountText} · {position.accountCode}</span>}</td>
      <td className="px-3 py-3">{typeLabels[position.investmentType]}<span className="mt-1 block font-mono text-[11px] text-muted-foreground">{position.investmentType}</span></td>
      <td className="px-3 py-3 font-mono text-xs">{position.projectCode}</td>
      <td className="px-3 py-3"><Badge variant="outline">{position.detailLevel === "municipality" ? t("detailed") : t("aggregated")}</Badge></td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums">{position.amountCents < 0 && <Badge className="mr-2" variant="destructive">{t("correction")}</Badge>}{exactCurrency.format(position.amountCents / 100)}</td>
    </tr>)}
  </>;
}
