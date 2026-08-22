"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Database, Download, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  INVESTMENT_TASK_AREAS,
  INVESTMENT_TYPES,
  normalizeInvestmentDescription,
  type InvestmentTaskAreaId,
  type InvestmentTypeId,
  type MunicipalityInvestmentAsset,
  type MunicipalityInvestmentData,
  type MunicipalityInvestmentPosition,
} from "../investments";

type SortKey = "year" | "description" | "amount";
const PAGE_SIZE = 200;
export type InitialInvestmentFilters = {
  year?: string;
  taskArea?: string;
  investmentType?: string;
  minimum?: string;
  query?: string;
};

export function MunicipalityInvestmentsClient({
  data,
  initialFilters = {},
}: {
  data: MunicipalityInvestmentData;
  initialFilters?: InitialInvestmentFilters;
}) {
  const t = useTranslations("municipalityInvestments");
  const locale = useLocale();
  const defaultYear = data.availableYears.includes(2024) ? "2024" : String(data.availableYears.at(-1));
  const [year, setYear] = useState(initialFilters.year ?? defaultYear);
  const [taskArea, setTaskArea] = useState(initialFilters.taskArea ?? "all");
  const [investmentType, setInvestmentType] = useState(initialFilters.investmentType ?? "all");
  const [minimum, setMinimum] = useState(initialFilters.minimum ?? "");
  const [query, setQuery] = useState(initialFilters.query ?? "");
  const [sort, setSort] = useState<SortKey>("amount");
  const [direction, setDirection] = useState<-1 | 1>(-1);
  const [selectedPosition, setSelectedPosition] = useState<MunicipalityInvestmentPosition | null>(null);
  const [page, setPage] = useState({ key: "", count: PAGE_SIZE });
  const currency = useMemo(() => new Intl.NumberFormat(locale, {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }), [locale]);
  const exactCurrency = useMemo(() => new Intl.NumberFormat(locale, {
    style: "currency", currency: "EUR",
  }), [locale]);
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const percent = useMemo(() => new Intl.NumberFormat(locale, {
    style: "percent", maximumFractionDigits: 1,
  }), [locale]);
  const taskLabels = Object.fromEntries(INVESTMENT_TASK_AREAS.map(({ id }) => [
    id, t(`taskArea${id}` as "taskArea0"),
  ])) as Record<InvestmentTaskAreaId, string>;
  const typeLabels = Object.fromEntries(INVESTMENT_TYPES.map(({ id }) => [
    id, t(`investmentType${id}` as "investmentType3411"),
  ])) as Record<InvestmentTypeId, string>;
  const assetsById = new Map(data.assets.map((asset) => [asset.id, asset]));

  useEffect(() => {
    const parameters = new URLSearchParams();
    if (year !== defaultYear) parameters.set("year", year);
    if (taskArea !== "all") parameters.set("task", taskArea);
    if (investmentType !== "all") parameters.set("type", investmentType);
    if (minimum) parameters.set("min", minimum);
    if (query) parameters.set("q", query);
    window.history.replaceState(null, "", `${window.location.pathname}${parameters.size ? `?${parameters}` : ""}`);
  }, [defaultYear, investmentType, minimum, query, taskArea, year]);

  // Changing any filter or sort collapses the table back to the first page.
  const pageKey = [year, taskArea, investmentType, minimum, query, sort, direction].join("|");
  const visibleCount = page.key === pageKey ? page.count : PAGE_SIZE;

  const normalizedQuery = normalizeInvestmentDescription(query);
  const minimumCents = (Number(minimum.replace(",", ".")) || 0) * 100;
  const matches = (position: MunicipalityInvestmentPosition, omit?: "year" | "task" | "type") => (
    (omit === "year" || year === "all" || position.year === Number(year))
    && (omit === "task" || taskArea === "all" || position.taskArea === taskArea)
    && (omit === "type" || investmentType === "all" || position.investmentType === investmentType)
    && Math.abs(position.amountCents) >= minimumCents
    && (!normalizedQuery || normalizeInvestmentDescription([
      position.approachText, position.accountText, position.projectCode,
      position.approachCode, position.accountCode,
      ...position.assetIds.flatMap((id) => {
        const asset = assetsById.get(id);
        return asset ? [asset.approachText, asset.accountText, asset.sourceAssetId] : [];
      }),
    ].join(" ")).includes(normalizedQuery))
  );
  const filtered = data.positions.filter((position) => matches(position));
  const sorted = [...filtered].sort((left, right) => {
    const result = sort === "year" ? left.year - right.year
      : sort === "amount" ? left.amountCents - right.amountCents
        : `${left.approachText} ${left.accountText}`.localeCompare(`${right.approachText} ${right.accountText}`, locale);
    return result * direction;
  });
  // ponytail: slice-and-grow instead of virtualisation — Graz across all years is 2.611
  // rows, so a page cap is enough; revisit if a municipality ever needs scroll-anchoring.
  const visible = sorted.slice(0, visibleCount);
  const grouped = visible.reduce<Array<{ id: InvestmentTaskAreaId; positions: MunicipalityInvestmentPosition[] }>>(
    (groups, position) => {
      const group = groups.find(({ id }) => id === position.taskArea);
      if (group) group.positions.push(position);
      else groups.push({ id: position.taskArea, positions: [position] });
      return groups;
    }, [],
  );
  const directInvestmentCents = filtered.reduce((sum, position) => sum + position.amountCents, 0);
  const matchedPositions = filtered.filter((position) => position.assetMatchStatus === "matched").length;
  const averageCents = filtered.length ? Math.round(directInvestmentCents / filtered.length) : 0;
  const byYear = data.availableYears.map((entryYear) => breakdown(
    String(entryYear), String(entryYear), data.positions.filter((position) => matches(position, "year") && position.year === entryYear),
  ));
  const byTask = INVESTMENT_TASK_AREAS.map(({ id }) => breakdown(
    id, taskLabels[id], data.positions.filter((position) => matches(position, "task") && position.taskArea === id),
  )).filter(({ count }) => count > 0).sort(byMagnitude);
  const byType = INVESTMENT_TYPES.map(({ id }) => breakdown(
    id, typeLabels[id], data.positions.filter((position) => matches(position, "type") && position.investmentType === id),
  )).filter(({ count }) => count > 0).sort(byMagnitude);

  const activeFilters = [
    year !== "all" ? { id: "year", label: `${t("year")}: ${year}`, clear: () => setYear("all") } : null,
    taskArea !== "all" ? { id: "task", label: taskLabels[taskArea as InvestmentTaskAreaId], clear: () => setTaskArea("all") } : null,
    investmentType !== "all" ? { id: "type", label: typeLabels[investmentType as InvestmentTypeId], clear: () => setInvestmentType("all") } : null,
    minimum ? { id: "minimum", label: `≥ ${minimum} €`, clear: () => setMinimum("") } : null,
    query ? { id: "query", label: `„${query}“`, clear: () => setQuery("") } : null,
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const periodLabel = year === "all" ? `${data.availableYears[0]}–${data.availableYears.at(-1)}` : year;

  function resetFilters() {
    setYear("all"); setTaskArea("all"); setInvestmentType("all"); setMinimum(""); setQuery("");
  }
  function downloadCsv() {
    // ponytail: separator and decimal mark follow the UI locale, which is what the
    // reader's Excel expects; no chooser until someone actually needs a third variant.
    const german = locale.startsWith("de");
    const separator = german ? ";" : ",";
    const cell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const amount = (cents: number) => {
      const value = (cents / 100).toFixed(2);
      return german ? value.replace(".", ",") : value;
    };
    const header = [
      t("year"), t("taskArea"), t("approachCode"), t("descriptionLabel"), t("accountText"),
      t("accountCode"), t("investmentType"), t("projectCode"), t("sourceDetail"), t("amount"),
    ];
    const rows = sorted.map((position) => [
      position.year, taskLabels[position.taskArea], position.approachCode, position.approachText,
      position.accountText, position.accountCode, typeLabels[position.investmentType],
      position.projectCode,
      position.detailLevel === "municipality" ? t("detailed") : t("aggregated"),
      amount(position.amountCents),
    ]);
    const csv = [header, ...rows].map((row) => row.map(cell).join(separator)).join("\r\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data.municipality.code}-investments-${periodLabel}.csv`;
    link.click();
    // Revoking synchronously can cancel the download before the browser reads the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function updateSort(next: SortKey) {
    if (sort === next) setDirection((value) => value === 1 ? -1 : 1);
    else { setSort(next); setDirection(next === "description" ? 1 : -1); }
  }

  return <div className="space-y-4 pb-8">
    <header className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm md:flex-row md:items-end md:justify-between">
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
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={downloadCsv} disabled={!filtered.length}>
          <Download className="size-4" />{t("downloadCsv")}
        </Button>
        <Button render={<a href={`/api/municipalities/${data.municipality.code}/investments/export`} />}>
          <Download className="size-4" />{t("downloadHtml")}
        </Button>
      </div>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("summary")}>
      {[
        [t("directInvestments"), currency.format(directInvestmentCents / 100)],
        [t("positions"), integer.format(filtered.length)],
        [t("assetDetails"), integer.format(matchedPositions)],
        [t("averagePosition"), currency.format(averageCents / 100)],
      ].map(([label, value]) => <Card key={label}><CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("period")}: {periodLabel}</p>
      </CardHeader></Card>)}
    </section>

    <Card>
      <CardContent className="grid gap-3 pt-1 sm:grid-cols-2 xl:grid-cols-5">
        <Filter label={t("year")}><select className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={year} onChange={(event) => setYear(event.target.value)}>
          <option value="all">{t("allYears")}</option>{[...data.availableYears].reverse().map((value) => <option key={value} value={value}>{value}</option>)}
        </select></Filter>
        <Filter label={t("taskArea")}><select className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={taskArea} onChange={(event) => setTaskArea(event.target.value)}>
          <option value="all">{t("allTaskAreas")}</option>{INVESTMENT_TASK_AREAS.map(({ id }) => <option key={id} value={id}>{taskLabels[id]}</option>)}
        </select></Filter>
        <Filter label={t("investmentType")}><select className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={investmentType} onChange={(event) => setInvestmentType(event.target.value)}>
          <option value="all">{t("allInvestmentTypes")}</option>{INVESTMENT_TYPES.map(({ id }) => <option key={id} value={id}>{typeLabels[id]}</option>)}
        </select></Filter>
        <Filter label={t("minimum")}><Input type="number" min="0" step="100" value={minimum} onValueChange={setMinimum} /></Filter>
        <Filter label={t("search")}><div className="relative"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input className="pl-9" type="search" value={query} onValueChange={setQuery} placeholder={t("searchPlaceholder")} /></div></Filter>
      </CardContent>
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-t px-6 py-3">
        <span className="text-xs font-semibold text-muted-foreground">{t("activeFilters")}</span>
        {activeFilters.length ? activeFilters.map((filter) => <button key={filter.id} type="button" onClick={filter.clear} className="rounded-full border bg-background px-3 py-1 text-xs font-medium hover:border-teal-500 hover:text-teal-700">{filter.label} ×</button>) : <span className="text-xs text-muted-foreground">{t("noActiveFilters")}</span>}
        <Button className="ml-auto" variant="ghost" size="sm" onClick={resetFilters}><RotateCcw className="size-4" />{t("resetFilters")}</Button>
      </div>
    </Card>

    <div className="grid gap-4 xl:grid-cols-[minmax(19rem,0.7fr)_minmax(0,1.3fr)] xl:items-start">
      <BreakdownCard title={t("trend")} description={t("trendDescription")} rows={byYear} selected={year} onSelect={(id) => setYear(year === id ? "all" : id)} currency={currency} percent={percent} empty={t("noResults")} />
      <div className="grid gap-4">
        <BreakdownCard title={t("breakdown")} rows={byTask} selected={taskArea} onSelect={(id) => setTaskArea(taskArea === id ? "all" : id)} currency={currency} percent={percent} empty={t("noResults")} />
        <BreakdownCard title={t("typeBreakdown")} rows={byType} selected={investmentType} onSelect={(id) => setInvestmentType(investmentType === id ? "all" : id)} currency={currency} percent={percent} empty={t("noResults")} />
      </div>
    </div>

    <Card><CardHeader><CardTitle>{t("details")}</CardTitle><CardDescription>{t("resultCount", { count: filtered.length })}</CardDescription></CardHeader><CardContent>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[72rem] border-collapse text-sm">
        <thead className="bg-muted/70 text-left text-xs text-muted-foreground"><tr>
          <SortableHeader label={t("year")} onClick={() => updateSort("year")} /><th className="px-3 py-2.5">{t("taskArea")}</th>
          <SortableHeader label={t("descriptionLabel")} onClick={() => updateSort("description")} /><th className="px-3 py-2.5">{t("investmentType")}</th>
          <th className="px-3 py-2.5">{t("projectCode")}</th><th className="px-3 py-2.5">{t("sourceDetail")}</th>
          <SortableHeader label={t("amount")} onClick={() => updateSort("amount")} align="right" />
        </tr></thead><tbody>{grouped.map((group) => <GroupRows key={group.id} group={group} taskLabels={taskLabels} typeLabels={typeLabels} exactCurrency={exactCurrency} t={t} onSelect={setSelectedPosition} />)}</tbody>
      </table>{!filtered.length && <p className="p-8 text-center text-sm text-muted-foreground">{t("noResults")}</p>}</div>
      {filtered.length > visible.length && <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{t("shownCount", { shown: integer.format(visible.length), total: integer.format(filtered.length) })}</p>
        <Button variant="outline" size="sm" onClick={() => setPage({ key: pageKey, count: visibleCount + PAGE_SIZE })}>
          {t("loadMore", { count: integer.format(Math.min(PAGE_SIZE, filtered.length - visible.length)) })}
        </Button>
      </div>}
    </CardContent></Card>

    <Card className="bg-muted/25"><CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-4" />{t("methodology")}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm leading-6 text-muted-foreground">
      <p>{t("methodologyTextV2")}</p>
      <p>{t("source")}: <a className="underline underline-offset-2" href={data.source.url} target="_blank" rel="noreferrer">{data.source.title}</a> · <a className="underline underline-offset-2" href={data.source.definitionUrl} target="_blank" rel="noreferrer">VRV 2015</a></p>
      <p className="text-xs">{data.years.map((entry) => `${entry.year}: ${entry.statisticsFile}${entry.municipalityFile ? ` + ${entry.municipalityFile}` : ""}${entry.assetMunicipalityFile && entry.assetReconciliation === "matched" ? ` + ${entry.assetMunicipalityFile}` : ""}`).join(" · ")}</p>
    </CardContent></Card>

    <InvestmentDetailDialog
      position={selectedPosition}
      assets={selectedPosition?.assetIds.map((id) => assetsById.get(id)).filter((asset): asset is MunicipalityInvestmentAsset => Boolean(asset)) ?? []}
      history={selectedPosition && selectedPosition.projectCode !== "0000000" ? data.positions.filter((entry) => entry.id !== selectedPosition.id && entry.projectCode === selectedPosition.projectCode) : []}
      exactCurrency={exactCurrency} taskLabels={taskLabels} typeLabels={typeLabels} t={t}
      onOpenChange={(open) => { if (!open) setSelectedPosition(null); }}
    />
  </div>;
}

type BreakdownRow = { id: string; label: string; value: number; count: number };
function breakdown(id: string, label: string, rows: MunicipalityInvestmentPosition[]): BreakdownRow {
  return { id, label, value: rows.reduce((sum, row) => sum + row.amountCents, 0), count: rows.length };
}
function byMagnitude(left: BreakdownRow, right: BreakdownRow) {
  return Math.abs(right.value) - Math.abs(left.value);
}
function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground"><span>{label}</span>{children}</label>;
}
function BreakdownCard({ title, description, rows, selected, onSelect, currency, percent, empty }: {
  title: string; description?: string; rows: BreakdownRow[]; selected: string; onSelect: (id: string) => void;
  currency: Intl.NumberFormat; percent: Intl.NumberFormat; empty: string;
}) {
  const maximum = Math.max(1, ...rows.map(({ value }) => Math.abs(value)));
  const total = rows.reduce((sum, row) => sum + Math.abs(row.value), 0);
  return <Card><CardHeader><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent className="space-y-2">
    {rows.length ? rows.map((row) => {
      const active = selected === row.id;
      const share = total ? Math.abs(row.value) / total : 0;
      return <button key={row.id} type="button" aria-pressed={active} title={`${row.label}: ${currency.format(row.value / 100)} · ${row.count} · ${percent.format(share)}`} onClick={() => onSelect(row.id)}
        className={`grid w-full grid-cols-[minmax(7rem,1fr)_minmax(7rem,2fr)_auto] items-center gap-3 rounded-lg p-2 text-left text-xs transition hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${active ? "bg-teal-50 ring-1 ring-teal-500 dark:bg-teal-950/30" : ""}`}>
        <span className="truncate font-medium" title={row.label}>{row.label}</span>
        <span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${row.value < 0 ? "bg-red-500" : "bg-teal-600"}`} style={{ width: `${Math.max(1, Math.abs(row.value) / maximum * 100)}%` }} /></span>
        <span className="text-right"><strong className="block tabular-nums">{currency.format(row.value / 100)}</strong><span className="text-[10px] text-muted-foreground">{row.count} · {percent.format(share)}</span></span>
      </button>;
    }) : <p className="text-sm text-muted-foreground">{empty}</p>}
  </CardContent></Card>;
}
function SortableHeader({ label, onClick, align = "left" }: { label: string; onClick: () => void; align?: "left" | "right" }) {
  return <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""}`}><button className="font-semibold hover:text-foreground" onClick={onClick}>{label} ↕</button></th>;
}
function GroupRows({ group, taskLabels, typeLabels, exactCurrency, t, onSelect }: {
  group: { id: InvestmentTaskAreaId; positions: MunicipalityInvestmentPosition[] };
  taskLabels: Record<InvestmentTaskAreaId, string>; typeLabels: Record<InvestmentTypeId, string>;
  exactCurrency: Intl.NumberFormat; t: ReturnType<typeof useTranslations<"municipalityInvestments">>;
  onSelect: (position: MunicipalityInvestmentPosition) => void;
}) {
  return <><tr className="border-t bg-muted/35"><td colSpan={7} className="px-3 py-2 font-semibold">{taskLabels[group.id]}</td></tr>
    {group.positions.map((position) => <tr key={position.id} className="border-t align-top transition hover:bg-muted/30">
      <td className="px-3 py-3 tabular-nums">{position.year}</td>
      <td className="px-3 py-3">{taskLabels[position.taskArea]}<span className="mt-1 block font-mono text-[11px] text-muted-foreground">{position.approachCode}</span></td>
      <td className="px-3 py-3"><button type="button" className="text-left hover:text-teal-700 hover:underline" onClick={() => onSelect(position)}><span className="font-medium">{position.approachText || "—"}</span>{position.accountText && <span className="mt-1 block text-xs text-muted-foreground">{position.accountText} · {position.accountCode}</span>}</button></td>
      <td className="px-3 py-3">{typeLabels[position.investmentType]}<span className="mt-1 block font-mono text-[11px] text-muted-foreground">{position.investmentType}</span></td>
      <td className="px-3 py-3 font-mono text-xs">{position.projectCode}</td>
      <td className="px-3 py-3"><div className="flex flex-wrap gap-1"><Badge variant="outline" title={position.detailLevel === "municipality" ? t("detailedHint") : t("aggregatedHint")}>{position.detailLevel === "municipality" ? t("detailed") : t("aggregated")}</Badge>{position.assetMatchStatus === "matched" && <Badge className="bg-teal-700 text-white" title={t("assetMatchedHint")}>{t("assetMatched")}</Badge>}{position.assetMatchStatus === "ambiguous" && <Badge variant="secondary" title={t("assetAmbiguousHint")}>{t("assetAmbiguous")}</Badge>}</div></td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums">{position.amountCents < 0 && <Badge className="mr-2" variant="destructive">{t("correction")}</Badge>}{exactCurrency.format(position.amountCents / 100)}</td>
    </tr>)}</>;
}
function InvestmentDetailDialog({ position, assets, history, exactCurrency, taskLabels, typeLabels, t, onOpenChange }: {
  position: MunicipalityInvestmentPosition | null; assets: MunicipalityInvestmentAsset[]; history: MunicipalityInvestmentPosition[];
  exactCurrency: Intl.NumberFormat; taskLabels: Record<InvestmentTaskAreaId, string>; typeLabels: Record<InvestmentTypeId, string>;
  t: ReturnType<typeof useTranslations<"municipalityInvestments">>; onOpenChange: (open: boolean) => void;
}) {
  return <Dialog open={Boolean(position)} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">{position && <>
    <DialogHeader><DialogTitle>{position.approachText || position.accountText || t("positionDetails")}</DialogTitle><DialogDescription>{t("positionDetailDescription")}</DialogDescription></DialogHeader>
    <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
      <Detail label={t("year")} value={String(position.year)} /><Detail label={t("amount")} value={exactCurrency.format(position.amountCents / 100)} />
      <Detail label={t("taskArea")} value={`${taskLabels[position.taskArea]} · ${position.approachCode}`} /><Detail label={t("investmentType")} value={`${typeLabels[position.investmentType]} · ${position.investmentType}`} />
      <Detail label={t("descriptionLabel")} value={`${position.approachText || "—"} · ${position.accountText || "—"} · ${position.accountCode}`} /><Detail label={t("projectCode")} value={position.projectCode} />
    </div>
    <section className="space-y-3"><h3 className="font-semibold">{t("linkedAssets")}</h3>
      {assets.length ? assets.map((asset) => <div key={asset.id} className="rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{asset.accountText || asset.approachText || asset.sourceAssetId}</p><p className="mt-1 text-xs text-muted-foreground">{asset.approachText} · MVAG {asset.mvagCode} · {asset.sourceAssetId}</p></div><Badge className="bg-teal-700 text-white">{t("exactlyMatched")}</Badge></div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><Detail label={t("assetAddition")} value={exactCurrency.format(asset.additionsCents / 100)} /><Detail label={t("assetDisposal")} value={exactCurrency.format(asset.disposalsCents / 100)} /><Detail label={t("openingBalance")} value={exactCurrency.format(asset.openingBalanceCents / 100)} /><Detail label={t("closingBalance")} value={exactCurrency.format(asset.closingBalanceCents / 100)} /></div>
        <p className="mt-3 text-xs text-muted-foreground">{t("source")}: {asset.sourceFile}</p>
      </div>) : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">{position.assetMatchStatus === "ambiguous" ? t("ambiguousAssetDetails") : t("noAssetDetails")}</p>}
    </section>
    {history.length > 0 && <section className="space-y-2"><h3 className="font-semibold">{t("projectHistory")}</h3>{history.map((entry) => <div key={entry.id} className="flex justify-between gap-4 rounded-lg border p-3 text-sm"><span>{entry.year} · {entry.approachText} · {entry.accountText}</span><strong className="whitespace-nowrap tabular-nums">{exactCurrency.format(entry.amountCents / 100)}</strong></div>)}</section>}
  </>}</DialogContent></Dialog>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-1 break-words">{value}</p></div>;
}
