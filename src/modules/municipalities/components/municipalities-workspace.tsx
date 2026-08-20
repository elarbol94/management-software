"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Database, MapPinned, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  searchMunicipalities,
  validateMunicipalityIndex,
  type MunicipalityIndex,
  type MunicipalityIndexItem,
} from "../data";
import {
  validateMunicipalityPopulationSeries,
  type MunicipalityPopulationSeries,
} from "../population";

const MunicipalityMap = dynamic(
  () => import("./municipality-map").then((module) => module.MunicipalityMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full min-h-[26rem] w-full rounded-2xl" />,
  },
);

async function fetchJson<T>(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function formatPopulationChange(value: number, formatter: Intl.NumberFormat) {
  return `${value > 0 ? "+" : ""}${formatter.format(value)}`;
}

export function MunicipalitiesWorkspace() {
  const t = useTranslations("municipalities");
  const locale = useLocale();
  const populationFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [index, setIndex] = useState<MunicipalityIndex | null>(null);
  const [populationSeries, setPopulationSeries] = useState<MunicipalityPopulationSeries | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const selectedCode = searchParams.get("municipality") ?? "";
  const selected = useMemo(
    () => index?.municipalities.find((item) => item.municipalityCode === selectedCode) ?? null,
    [index, selectedCode],
  );
  const selectedPopulationYear = useMemo(() => {
    const populationYear = Number(searchParams.get("populationYear"));
    if (populationSeries && Number.isInteger(populationYear) && populationYear >= populationSeries.firstYear && populationYear <= populationSeries.latestYear) {
      return populationYear;
    }
    return populationSeries?.latestYear ?? null;
  }, [populationSeries, searchParams]);
  const activePopulation = selectedPopulationYear === null ? null : populationSeries?.years[String(selectedPopulationYear)] ?? null;
  const previousPopulation = selectedPopulationYear === null || selectedPopulationYear <= (populationSeries?.firstYear ?? 0)
    ? null
    : populationSeries?.years[String(selectedPopulationYear - 1)] ?? null;
  const firstPopulation = populationSeries?.years[String(populationSeries.firstYear)] ?? null;
  const results = useMemo(
    () => index ? searchMunicipalities(index.municipalities, query) : [],
    [index, query],
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchJson<MunicipalityIndex>("/data/municipalities-at-2026.index.json", controller.signal),
      fetchJson<MunicipalityPopulationSeries>("/data/municipality-population-2002-2025.json", controller.signal),
    ])
      .then(([indexData, populationData]) => {
        const validatedIndex = validateMunicipalityIndex(indexData);
        const validatedPopulationSeries = validateMunicipalityPopulationSeries(
          populationData,
          validatedIndex.municipalities.map(({ municipalityCode }) => municipalityCode),
        );
        setIndex(validatedIndex);
        setPopulationSeries(validatedPopulationSeries);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(true);
      });
    return () => controller.abort();
  }, []);

  function replaceSearchParams(next: URLSearchParams) {
    const queryString = next.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function updateSelection(municipality: MunicipalityIndexItem | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (municipality) next.set("municipality", municipality.municipalityCode);
    else next.delete("municipality");
    replaceSearchParams(next);
    setSearchOpen(false);
    setQuery(municipality?.name ?? "");
  }

  function updatePopulationYear(year: number) {
    if (!populationSeries || year < populationSeries.firstYear || year > populationSeries.latestYear) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("populationYear", String(year));
    replaceSearchParams(next);
  }

  function selectByCode(code: string) {
    const municipality = index?.municipalities.find((item) => item.municipalityCode === code);
    if (municipality) updateSelection(municipality);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) {
      if (event.key === "Escape") setSearchOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveResult((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveResult((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      updateSelection(results[activeResult] ?? results[0]);
    } else if (event.key === "Escape") {
      setSearchOpen(false);
    }
  }

  if (loadError) {
    return (
      <div className="grid min-h-[34rem] place-items-center rounded-2xl border border-dashed bg-muted/20 p-8 text-center" role="alert">
        <div><MapPinned className="mx-auto mb-3 size-9 text-muted-foreground" /><p className="font-semibold">{t("loadErrorTitle")}</p><p className="mt-1 text-sm text-muted-foreground">{t("loadErrorDescription")}</p></div>
      </div>
    );
  }
  if (!index || !populationSeries || !activePopulation || selectedPopulationYear === null) {
    return <Skeleton className="h-[calc(100dvh-12rem)] min-h-[34rem] w-full rounded-2xl" />;
  }

  const selectedPopulation = selected ? activePopulation.values[selected.municipalityCode] : 0;
  const populationChangePreviousYear = selected && previousPopulation ? selectedPopulation - previousPopulation.values[selected.municipalityCode] : null;
  const populationChangeSinceFirstYear = selected && firstPopulation ? selectedPopulation - firstPopulation.values[selected.municipalityCode] : null;

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]" data-testid="municipalities-workspace">
      <section className="relative h-[60dvh] min-h-[28rem] lg:h-[calc(100dvh-12rem)] lg:min-h-[38rem]" aria-label={t("mapRegionLabel")}>
        <div className="absolute top-3 left-3 z-20 w-[min(24rem,calc(100%-5.5rem))]">
          <div className="relative rounded-xl border bg-background/95 shadow-lg backdrop-blur">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setActiveResult(0); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              aria-autocomplete="list"
              aria-controls="municipality-search-results"
              aria-expanded={searchOpen && results.length > 0}
              role="combobox"
              className="h-10 w-full rounded-xl bg-transparent pr-10 pl-9 text-sm outline-none focus:ring-2 focus:ring-teal-600/40"
            />
            {query && <button type="button" aria-label={t("clearSearch")} className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md hover:bg-accent" onClick={() => { setQuery(""); setSearchOpen(false); }}><X className="size-4" /></button>}
            {searchOpen && query && (
              <div id="municipality-search-results" role="listbox" className="absolute top-[calc(100%+0.4rem)] max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl">
                {results.length ? results.map((municipality, indexPosition) => (
                  <button
                    key={municipality.municipalityCode}
                    type="button"
                    role="option"
                    aria-selected={indexPosition === activeResult}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${indexPosition === activeResult ? "bg-accent" : "hover:bg-accent"}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveResult(indexPosition)}
                    onClick={() => updateSelection(municipality)}
                  >
                    <span><span className="block font-medium">{municipality.name}</span><span className="block text-xs text-muted-foreground">{municipality.state}</span></span>
                    <span className="font-mono text-xs text-muted-foreground">{municipality.municipalityCode}</span>
                  </button>
                )) : <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("noSearchResults")}</p>}
              </div>
            )}
          </div>
        </div>

        <MunicipalityMap
          austriaBounds={index.bounds}
          selected={selected}
          populationValues={activePopulation.values}
          populationYear={selectedPopulationYear}
          firstPopulationYear={populationSeries.firstYear}
          latestPopulationYear={populationSeries.latestYear}
          onPopulationYearChange={updatePopulationYear}
          onSelect={selectByCode}
          onReset={() => updateSelection(null)}
          mapLabel={t("mapLabel")}
          zoomInLabel={t("zoomIn")}
          zoomOutLabel={t("zoomOut")}
          resetLabel={t("allAustria")}
          municipalityCodeLabel={t("municipalityCode")}
          populationLabel={t("population")}
          populationReferenceLabel={t("populationReference", { year: selectedPopulationYear })}
          populationYearLabel={t("populationYear")}
          previousPopulationYearLabel={t("previousPopulationYear")}
          nextPopulationYearLabel={t("nextPopulationYear")}
        />
      </section>

      <aside className="flex flex-col gap-4" aria-live="polite" data-testid="municipality-details">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          {selected ? (
            <>
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300"><MapPinned className="size-5" /></div>
              <p className="text-xs font-semibold tracking-[0.14em] text-teal-700 uppercase dark:text-teal-300">{t("selectedMunicipality")}</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">{selected.name}</h2>
              <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("population")}</dt><dd className="font-semibold tabular-nums">{populationFormatter.format(selectedPopulation)}</dd>
                <dt className="text-muted-foreground">{t("populationChangePreviousYear")}</dt><dd className="font-medium tabular-nums">{populationChangePreviousYear === null ? "—" : formatPopulationChange(populationChangePreviousYear, populationFormatter)}</dd>
                <dt className="text-muted-foreground">{t("populationChangeSinceFirstYear", { year: populationSeries.firstYear })}</dt><dd className="font-medium tabular-nums">{populationChangeSinceFirstYear === null ? "—" : formatPopulationChange(populationChangeSinceFirstYear, populationFormatter)}</dd>
                <dt className="text-muted-foreground">{t("state")}</dt><dd className="font-medium">{selected.state}</dd>
                <dt className="text-muted-foreground">{t("municipalityCode")}</dt><dd className="font-mono font-medium">{selected.municipalityCode}</dd>
              </dl>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="size-3.5" />{t("populationReference", { year: selectedPopulationYear })}</p>
              <Button variant="outline" className="mt-5 w-full" onClick={() => updateSelection(null)}><X className="size-4" />{t("clearSelection")}</Button>
            </>
          ) : (
            <>
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><MapPinned className="size-5" /></div>
              <h2 className="font-semibold">{t("selectionTitle")}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("selectionDescription")}</p>
            </>
          )}
        </div>
        <div className="rounded-2xl border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 font-semibold text-foreground"><Database className="size-4" />{t("dataBasis")}</div>
          <p>{t("dataBasisDescription", { count: index.count })}</p>
          <p className="mt-2">
            {t("populationDataBasis", { firstYear: populationSeries.firstYear, latestYear: populationSeries.latestYear })}{" "}
            <a className="underline underline-offset-2 hover:text-foreground" href={populationSeries.source.urlTemplate.replace("{year}", String(populationSeries.latestYear))} target="_blank" rel="noreferrer">{populationSeries.source.title}</a>
            {` (${populationSeries.source.license}).`}
          </p>
          <p className="mt-2">{t("geometryAttribution")}</p>
        </div>
      </aside>
    </div>
  );
}
