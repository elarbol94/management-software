"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Database, Landmark, MapPinned, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MunicipalityDatasetRef } from "../analysis";
import {
  COST_CATEGORIES,
  MUNICIPALITY_COSTS_FIRST_YEAR,
  MUNICIPALITY_COSTS_LATEST_YEAR,
  isCostCategoryId,
  isCostMeasureId,
  municipalityCostCategoryCents,
  median,
  municipalityCostPerCapita,
  municipalityCostRealPerCapita,
  municipalityPopulationBand,
  municipalityCostShare,
  validateMunicipalityCostSeries,
  type CostCategoryId,
  type CostMeasureId,
  type MunicipalityCostSeries,
} from "../costs";
import {
  searchMunicipalities,
  validateMunicipalityIndex,
  type MunicipalityIndex,
  type MunicipalityIndexItem,
} from "../data";
import type { MunicipalityInvestmentIndex } from "../investments";
import {
  DEMOGRAPHIC_INDICATORS,
  demographicIndicatorUnit,
  demographicIndicatorValue,
  demographyMetricValue,
  demographyPopulation,
  demographyValue,
  isAgeGroupId,
  isDemographicIndicatorId,
  percentileDomain,
  validateMunicipalityDemographySeries,
  type AgeGroupId,
  type AgeMeasure,
  type AgeViewId,
  type DemographicIndicatorId,
  type MapMetric,
  type MunicipalityDemographySeries,
  type MunicipalitySexAgeCounts,
  type SexFilter,
} from "../demography";
import {
  isMovementMetricId,
  movementMetricPalette,
  movementMetricUnit,
  movementMetricValue,
  movementStatisticalCorrection,
  validateMunicipalityMovementSeries,
  type MovementMetricId,
  type MunicipalityMovementSeries,
} from "../movement";
import {
  validateMunicipalityPopulationSeries,
  type MunicipalityPopulationSeries,
} from "../population";
import {
  MUNICIPALITY_STRUCTURE_FIRST_YEAR,
  MUNICIPALITY_STRUCTURE_LATEST_YEAR,
  isPopulationViewId,
  populationViewUnit,
  populationViewValue,
  validateMunicipalityStructureSeries,
  type MunicipalityStructureSeries,
  type PopulationViewId,
} from "../structure";

const MunicipalityMap = dynamic(
  () => import("./municipality-map").then((module) => module.MunicipalityMap),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="h-full min-h-[26rem] w-full rounded-2xl" />
    ),
  },
);
async function fetchJson<T>(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

type MunicipalityProfile = { district: string | null; officialWebsite: string | null; mayor: string | null; councilComposition: string | null };
type MunicipalityProfileDataset = { profiles: Record<string, MunicipalityProfile> };
const formatSigned = (value: number, formatter: Intl.NumberFormat) =>
  `${value > 0 ? "+" : ""}${formatter.format(value)}`;

function populationBandRange(population: number, formatter: Intl.NumberFormat) {
  const limits = [1_000, 2_500, 5_000, 10_000, 20_000, 50_000];
  const band = municipalityPopulationBand(population);
  const minimum = band === 1 ? 0 : limits[band - 2];
  const maximum = limits[band - 1] ?? null;
  if (maximum === null) return "≥ " + formatter.format(minimum);
  if (minimum === 0) return "< " + formatter.format(maximum);
  return formatter.format(minimum) + "–" + formatter.format(maximum - 1);
}

export function MunicipalitiesWorkspace() {
  const t = useTranslations("municipalities");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const personsFormatter = useMemo(
    () => new Intl.NumberFormat(locale),
    [locale],
  );
  const shareFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const signedShareFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        signDisplay: "always",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const ratioFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }),
    [locale],
  );
  const signedDecimalFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        signDisplay: "always",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const [index, setIndex] = useState<MunicipalityIndex | null>(null);
  const [populationSeries, setPopulationSeries] =
    useState<MunicipalityPopulationSeries | null>(null);
  const [demographySeries, setDemographySeries] =
    useState<MunicipalityDemographySeries | null>(null);
  const [movementSeries, setMovementSeries] =
    useState<MunicipalityMovementSeries | null>(null);
  const [structureSeries, setStructureSeries] =
    useState<MunicipalityStructureSeries | null>(null);
  const [costSeries, setCostSeries] = useState<MunicipalityCostSeries | null>(null);
  const [investmentMunicipalityCodes, setInvestmentMunicipalityCodes] = useState<Set<string> | null>(null);
  const [profiles, setProfiles] = useState<MunicipalityProfileDataset | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [demographyError, setDemographyError] = useState(false);
  const [movementError, setMovementError] = useState(false);
  const [structureError, setStructureError] = useState(false);
  const [costError, setCostError] = useState(false);
  const paramsRef = useRef(searchParams.toString());
  useEffect(() => {
    paramsRef.current = searchParams.toString();
  }, [searchParams]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);

  const populationViewParameter = searchParams.get("populationView") ?? "count";
  const populationView: PopulationViewId = isPopulationViewId(populationViewParameter)
    ? populationViewParameter
    : "count";
  const metricParameter = searchParams.get("metric");
  const metric: MapMetric =
    metricParameter === "age" || metricParameter === "movement" || metricParameter === "costs"
      ? metricParameter
      : "population";
  const ageGroupParameter = searchParams.get("ageGroup") ?? "0-5";
  const ageGroup: AgeGroupId = isAgeGroupId(ageGroupParameter)
    ? ageGroupParameter
    : "0-5";
  const indicatorParameter = searchParams.get("ageIndicator") ?? "";
  const indicator: DemographicIndicatorId | null = isDemographicIndicatorId(
    indicatorParameter,
  )
    ? indicatorParameter
    : null;
  const ageView: AgeViewId = indicator ?? ageGroup;
  const ageMeasure: AgeMeasure =
    searchParams.get("ageMeasure") === "persons" ? "persons" : "share";
  const sexParameter = searchParams.get("sex");
  const sex: SexFilter =
    sexParameter === "female" || sexParameter === "male" ? sexParameter : "all";
  const movementParameter =
    searchParams.get("movementMetric") ?? "population-change";
  const movementView: MovementMetricId = isMovementMetricId(movementParameter)
    ? movementParameter
    : "population-change";
  const costCategoryParameter = searchParams.get("costCategory") ?? "0";
  const costCategory: CostCategoryId = isCostCategoryId(costCategoryParameter) ? costCategoryParameter : "0";
  const costMeasureParameter = searchParams.get("costMeasure") ?? "share";
  const costMeasure: CostMeasureId = isCostMeasureId(costMeasureParameter)
    ? costMeasureParameter : "share";
  const selectedCode = searchParams.get("municipality") ?? "";
  const selected = useMemo(
    () =>
      index?.municipalities.find(
        (item) => item.municipalityCode === selectedCode,
      ) ?? null,
    [index, selectedCode],
  );
  const usesCitizenship = metric === "population" && (populationView === "foreign-share" || populationView === "foreign-persons");
  const selectedProfile = selected ? (profiles?.profiles[selected.municipalityCode] ?? null) : null;
  const availableFirstYear = metric === "costs"
    ? MUNICIPALITY_COSTS_FIRST_YEAR
    : usesCitizenship ? MUNICIPALITY_STRUCTURE_FIRST_YEAR : populationSeries?.firstYear;
  const availableLatestYear = metric === "costs"
    ? MUNICIPALITY_COSTS_LATEST_YEAR
    : usesCitizenship ? MUNICIPALITY_STRUCTURE_LATEST_YEAR : populationSeries?.latestYear;
  const year = useMemo(() => {
    const value = Number(searchParams.get("populationYear"));
    return populationSeries && availableFirstYear !== undefined && availableLatestYear !== undefined &&
      Number.isInteger(value) && value >= availableFirstYear && value <= availableLatestYear
      ? value
      : (availableLatestYear ?? null);
  }, [availableFirstYear, availableLatestYear, populationSeries, searchParams]);
  const activePopulation =
    year === null ? null : (populationSeries?.years[String(year)] ?? null);
  const ageGroupLabels: Record<AgeGroupId, string> = {
    "0-5": t("ageGroup0-5"),
    "6-14": t("ageGroup6-14"),
    "15-24": t("ageGroup15-24"),
    "25-44": t("ageGroup25-44"),
    "45-64": t("ageGroup45-64"),
    "65-79": t("ageGroup65-79"),
    "80-plus": t("ageGroup80-plus"),
  };
  const populationViewLabels: Record<PopulationViewId, string> = {
    count: t("populationCount"),
    density: t("populationDensity"),
    "foreign-share": t("populationForeignShare"),
    "foreign-persons": t("populationForeignPersons"),
  };
  const populationViewDefinitions: Partial<Record<PopulationViewId, string>> = {
    density: t("populationDensityDefinition"),
    "foreign-share": t("populationForeignShareDefinition"),
    "foreign-persons": t("populationForeignPersonsDefinition"),
  };
  const indicatorLabels: Record<DemographicIndicatorId, string> = {
    "youth-share": t("indicatorYouthShare"),
    "senior-share": t("indicatorSeniorShare"),
    "old-age-dependency": t("indicatorOldAgeDependency"),
    "child-dependency": t("indicatorChildDependency"),
    "total-dependency": t("indicatorTotalDependency"),
    "aging-index": t("indicatorAgingIndex"),
    "average-age": t("indicatorAverageAge"),
    "women-share": t("indicatorWomenShare"),
    "women-per-100-men": t("indicatorWomenPer100Men"),
  };
  const indicatorDefinitions: Record<DemographicIndicatorId, string> = {
    "youth-share": t("indicatorYouthShareDefinition"),
    "senior-share": t("indicatorSeniorShareDefinition"),
    "old-age-dependency": t("indicatorOldAgeDependencyDefinition"),
    "child-dependency": t("indicatorChildDependencyDefinition"),
    "total-dependency": t("indicatorTotalDependencyDefinition"),
    "aging-index": t("indicatorAgingIndexDefinition"),
    "average-age": t("indicatorAverageAgeDefinition"),
    "women-share": t("indicatorWomenShareDefinition"),
    "women-per-100-men": t("indicatorWomenPer100MenDefinition"),
  };
  const movementLabels: Record<MovementMetricId, string> = {
    "population-change": t("movementPopulationChange"),
    births: t("movementBirths"),
    deaths: t("movementDeaths"),
    "birth-rate": t("movementBirthRate"),
    "death-rate": t("movementDeathRate"),
    "birth-balance-rate": t("movementBirthBalanceRate"),
    arrivals: t("movementArrivals"),
    departures: t("movementDepartures"),
    "migration-balance-rate": t("movementMigrationBalanceRate"),
    "international-migration-balance": t("movementInternationalBalance"),
    "international-migration-balance-rate": t("movementInternationalBalanceRate"),
    "internal-migration-balance": t("movementInternalBalance"),
    "internal-migration-balance-rate": t("movementInternalBalanceRate"),
    "statistical-correction": t("movementStatisticalCorrection"),
  };
  const movementDefinitions: Partial<Record<MovementMetricId, string>> = {
    "population-change": t("movementPopulationChangeDefinition"),
    "birth-rate": t("movementBirthRateDefinition"),
    "death-rate": t("movementDeathRateDefinition"),
    "birth-balance-rate": t("movementBirthBalanceRateDefinition"),
    "migration-balance-rate": t("movementMigrationBalanceRateDefinition"),
    "international-migration-balance": t("movementInternationalBalanceDefinition"),
    "international-migration-balance-rate": t("movementInternationalBalanceRateDefinition"),
    "internal-migration-balance": t("movementInternalBalanceDefinition"),
    "internal-migration-balance-rate": t("movementInternalBalanceRateDefinition"),
    "statistical-correction": t("movementStatisticalCorrectionDefinition"),
  };
  const costCategoryLabels: Record<CostCategoryId, string> = Object.fromEntries(
    COST_CATEGORIES.map(({ id }) => [id, t(`costCategory${id}` as "costCategory0")]),
  ) as Record<CostCategoryId, string>;
  const costMeasureLabels: Record<CostMeasureId, string> = {
    share: t("costMeasureShare"),
    "per-capita": t("costMeasurePerCapita"),
    "real-per-capita": t("costMeasureRealPerCapita"),
    "peer-deviation": t("costMeasurePeerDeviation"),
  };
  const costMeasureDefinitions: Record<CostMeasureId, string> = {
    share: t("costMeasureShareDefinition"),
    "per-capita": t("costMeasurePerCapitaDefinition"),
    "real-per-capita": t("costMeasureRealPerCapitaDefinition"),
    "peer-deviation": t("costMeasurePeerDeviationDefinition"),
  };
  const results = useMemo(
    () => (index ? searchMunicipalities(index.municipalities, query) : []),
    [index, query],
  );
  const indicatorScales = useMemo(() => {
    if (!demographySeries) return null;
    return Object.fromEntries(
      DEMOGRAPHIC_INDICATORS.map(({ id }) => [
        id,
        percentileDomain(
          Object.values(demographySeries.years).flatMap((snapshot) =>
            Object.values(snapshot.values)
              .map((counts) => demographicIndicatorValue(counts, id))
              .filter((value): value is number => value !== null),
          ),
        ),
      ]),
    ) as Record<DemographicIndicatorId, [number, number]>;
  }, [demographySeries]);
  const densityScale = useMemo(() => {
    if (!index || !populationSeries) return null;
    return percentileDomain(
      Object.values(populationSeries.years).flatMap(({ values }) =>
        index.municipalities.map((municipality) =>
          values[municipality.municipalityCode] / municipality.areaSquareKilometers,
        ),
      ),
    );
  }, [index, populationSeries]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchJson<MunicipalityIndex>(
        "/data/municipalities-at-2026.index.json",
        controller.signal,
      ),
      fetchJson<MunicipalityPopulationSeries>(
        "/data/municipality-population-2002-2025.json",
        controller.signal,
      ),
    ])
      .then(([indexData, populationData]) => {
        const validIndex = validateMunicipalityIndex(indexData);
        setIndex(validIndex);
        setPopulationSeries(
          validateMunicipalityPopulationSeries(
            populationData,
            validIndex.municipalities.map(
              ({ municipalityCode }) => municipalityCode,
            ),
          ),
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setLoadError(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchJson<MunicipalityInvestmentIndex>(
      "/data/municipality-investments/index.json",
      controller.signal,
    )
      .then((data) => setInvestmentMunicipalityCodes(
        new Set(data.municipalities.map(({ code }) => code)),
      ))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchJson<MunicipalityProfileDataset>("/data/municipality-profiles.json", controller.signal)
      .then(setProfiles)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (
      metric !== "age" ||
      demographySeries ||
      demographyError ||
      !index ||
      !populationSeries
    )
      return;
    const controller = new AbortController();
    fetchJson<MunicipalityDemographySeries>(
      "/data/municipality-demography-2002-2025.json",
      controller.signal,
    )
      .then((data) =>
        setDemographySeries(
          validateMunicipalityDemographySeries(
            data,
            populationSeries,
            index.municipalities.map(
              ({ municipalityCode }) => municipalityCode,
            ),
          ),
        ),
      )
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setDemographyError(true);
      });
    return () => controller.abort();
  }, [demographyError, demographySeries, index, metric, populationSeries]);
  useEffect(() => {
    if (
      metric !== "movement" ||
      movementSeries ||
      movementError ||
      !index ||
      !populationSeries
    )
      return;
    const controller = new AbortController();
    fetchJson<MunicipalityMovementSeries>(
      "/data/municipality-movement-2002-2025.json",
      controller.signal,
    )
      .then((data) =>
        setMovementSeries(
          validateMunicipalityMovementSeries(
            data,
            populationSeries,
            index.municipalities.map(
              ({ municipalityCode }) => municipalityCode,
            ),
          ),
        ),
      )
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError"))
          setMovementError(true);
      });
    return () => controller.abort();
  }, [index, metric, movementError, movementSeries, populationSeries]);

  useEffect(() => {
    if (!usesCitizenship || structureSeries || structureError || !index || !populationSeries) return;
    const controller = new AbortController();
    fetchJson<MunicipalityStructureSeries>(
      "/data/municipality-structure-2022-2024.json",
      controller.signal,
    )
      .then((data) =>
        setStructureSeries(
          validateMunicipalityStructureSeries(
            data,
            populationSeries,
            index.municipalities.map(({ municipalityCode }) => municipalityCode),
          ),
        ),
      )
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setStructureError(true);
      });
    return () => controller.abort();
  }, [index, populationSeries, structureError, structureSeries, usesCitizenship]);

  useEffect(() => {
    if (metric !== "costs" || costSeries || costError || !index) return;
    const controller = new AbortController();
    fetchJson<MunicipalityCostSeries>(
      "/data/municipality-cost-shares-2010-2024.json",
      controller.signal,
    )
      .then((data) => setCostSeries(validateMunicipalityCostSeries(
        data,
        index.municipalities.map(({ municipalityCode }) => municipalityCode),
      )))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setCostError(true);
      });
    return () => controller.abort();
  }, [costError, costSeries, index, metric]);

  function replace(next: URLSearchParams) {
    const value = next.toString();
    paramsRef.current = value;
    router.replace(value ? `${pathname}?${value}` : pathname, {
      scroll: false,
    });
  }
  function setParameter(name: string, value: string | null) {
    const next = new URLSearchParams(paramsRef.current);
    if (value === null) next.delete(name);
    else next.set(name, value);
    replace(next);
  }
  function updatePopulationView(view: PopulationViewId) {
    const next = new URLSearchParams(paramsRef.current);
    if (view === "count") next.delete("populationView");
    else next.set("populationView", view);
    if ((view === "foreign-share" || view === "foreign-persons") && (year === null || year < MUNICIPALITY_STRUCTURE_FIRST_YEAR || year > MUNICIPALITY_STRUCTURE_LATEST_YEAR)) {
      next.set("populationYear", String(MUNICIPALITY_STRUCTURE_LATEST_YEAR));
    }
    replace(next);
  }
  function updateAgeView(view: AgeViewId) {
    const next = new URLSearchParams(paramsRef.current);
    if (isDemographicIndicatorId(view)) {
      next.set("ageIndicator", view);
      next.delete("ageGroup");
      next.delete("ageMeasure");
      next.delete("sex");
    } else {
      next.set("ageGroup", view);
      next.delete("ageIndicator");
    }
    replace(next);
  }
  function updateMetric(value: MapMetric) {
    const next = new URLSearchParams(paramsRef.current);
    if (value === "population") next.delete("metric");
    else next.set("metric", value);
    if (value === "costs" && (year === null || year < MUNICIPALITY_COSTS_FIRST_YEAR || year > MUNICIPALITY_COSTS_LATEST_YEAR)) {
      next.set("populationYear", String(MUNICIPALITY_COSTS_LATEST_YEAR));
    }
    replace(next);
  }
  function updateSelection(item: MunicipalityIndexItem | null) {
    setParameter("municipality", item?.municipalityCode ?? null);
    setSearchOpen(false);
    setQuery(item?.name ?? "");
  }
  function selectByCode(code: string) {
    const item = index?.municipalities.find(
      ({ municipalityCode }) => municipalityCode === code,
    );
    if (item) updateSelection(item);
  }
  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!results.length) {
      if (event.key === "Escape") setSearchOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveResult((value) => (value + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchOpen(true);
      setActiveResult((value) => (value - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      updateSelection(results[activeResult] ?? results[0]);
    } else if (event.key === "Escape") setSearchOpen(false);
  }

  if (loadError)
    return (
      <div
        className="grid min-h-[34rem] place-items-center rounded-2xl border border-dashed bg-muted/20 p-8 text-center"
        role="alert"
      >
        <div>
          <MapPinned className="mx-auto mb-3 size-9 text-muted-foreground" />
          <p className="font-semibold">{t("loadErrorTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("loadErrorDescription")}
          </p>
        </div>
      </div>
    );
  if (!index || !populationSeries || !activePopulation || year === null)
    return (
      <Skeleton className="h-[calc(100dvh-12rem)] min-h-[34rem] w-full rounded-2xl" />
    );

  const valueForCounts = (counts: MunicipalitySexAgeCounts) =>
    indicator
      ? demographicIndicatorValue(counts, indicator)
      : demographyMetricValue(counts, sex, ageGroup, ageMeasure);
  const activeDemography = demographySeries?.years[String(year)] ?? null;
  const activeMovement = movementSeries?.years[String(year)] ?? null;
  const activeCosts = costSeries?.years[String(year)] ?? null;
  const populationUnit = populationViewUnit(populationView);
  const populationViewFormatter =
    populationUnit === "persons" ? personsFormatter : populationUnit === "share" ? shareFormatter : ratioFormatter;
  const populationUnitLabel =
    populationUnit === "persons" ? t("populationUnit") : populationUnit === "share" ? "" : t("populationDensityUnit");
  const populationValueFor = (code: string, targetYear: number) => {
    const municipality = index.municipalities.find((item) => item.municipalityCode === code);
    if (!municipality) return null;
    const citizenship = structureSeries?.years[String(targetYear)]?.values[code] ?? null;
    return populationViewValue(
      populationView,
      populationSeries.years[String(targetYear)].values[code],
      municipality,
      citizenship,
    );
  };
  const movementUnit = movementMetricUnit(movementView);
  const movementFormatter =
    movementUnit === "persons" ? personsFormatter : ratioFormatter;
  const movementUnitLabel =
    movementUnit === "persons" ? t("populationUnit") : t("per1000Inhabitants");
  const movementValueFor = (code: string, targetYear: number) => {
    if (!movementSeries) return null;
    return movementMetricValue(
      movementSeries.years[String(targetYear)].values[code],
      populationSeries.years[String(targetYear)].values[code],
      movementView,
    );
  };
  const peerMedianCache = new Map<number, Map<string, number | null>>();
  const peerMedianFor = (code: string, targetYear: number) => {
    let medians = peerMedianCache.get(targetYear);
    if (!medians) {
      const groups = new Map<string, number[]>();
      const costs = costSeries?.years[String(targetYear)]?.values ?? {};
      const populations = populationSeries.years[String(targetYear)].values;
      for (const municipality of index.municipalities) {
        const population = populations[municipality.municipalityCode];
        const tuple = costs[municipality.municipalityCode];
        if (!tuple || !population) continue;
        const value = municipalityCostPerCapita(tuple, costCategory, population);
        if (value === null) continue;
        const band = municipalityPopulationBand(population);
        for (const key of [municipality.state + "|" + band, "*|" + band]) {
          const group = groups.get(key);
          if (group) group.push(value);
          else groups.set(key, [value]);
        }
      }
      medians = new Map();
      for (const municipality of index.municipalities) {
        const population = populations[municipality.municipalityCode];
        const band = municipalityPopulationBand(population);
        const regional = groups.get(municipality.state + "|" + band);
        const comparison = regional && regional.length >= 5
          ? regional : groups.get("*|" + band) ?? [];
        medians.set(municipality.municipalityCode, median(comparison));
      }
      peerMedianCache.set(targetYear, medians);
    }
    return medians.get(code) ?? null;
  };
  const selectedPeerGroup = (() => {
    if (metric !== "costs" || costMeasure !== "peer-deviation" || !selected || !activeCosts) return null;
    const selectedPopulation = populationSeries.years[String(year)].values[selected.municipalityCode];
    if (!selectedPopulation) return null;
    const band = municipalityPopulationBand(selectedPopulation);
    const peers = index.municipalities.flatMap((municipality) => {
      const population = populationSeries.years[String(year)].values[municipality.municipalityCode];
      const costs = activeCosts.values[municipality.municipalityCode];
      if (!population || !costs || municipalityPopulationBand(population) !== band) return [];
      return municipalityCostPerCapita(costs, costCategory, population) === null ? [] : [municipality];
    });
    const regionalPeers = peers.filter((municipality) => municipality.state === selected.state);
    const comparison = regionalPeers.length >= 5 ? regionalPeers : peers;
    if (!comparison.length) return null;
    return {
      municipalityCodes: comparison.map((municipality) => municipality.municipalityCode),
      label: t("peerComparisonGroup", {
        count: comparison.length,
        scope: regionalPeers.length >= 5 ? selected.state : t("allAustria"),
        range: populationBandRange(selectedPopulation, personsFormatter),
      }),
    };
  })();

  const costValueFor = (code: string, targetYear: number) => {
    const value = costSeries?.years[String(targetYear)]?.values[code];
    if (!value) return null;
    if (costMeasure === "share") return municipalityCostShare(value, costCategory);
    const population = populationSeries.years[String(targetYear)].values[code];
    if (costMeasure === "real-per-capita") {
      return municipalityCostRealPerCapita(value, costCategory, population, targetYear);
    }
    const perCapita = municipalityCostPerCapita(value, costCategory, population);
    if (costMeasure === "per-capita") return perCapita;
    const peerMedian = peerMedianFor(code, targetYear);
    return perCapita !== null && peerMedian && peerMedian > 0 ? perCapita / peerMedian - 1 : null;
  };
  const metricValues: Record<string, number | null> =
    metric === "population"
      ? Object.fromEntries(
          index.municipalities.map(({ municipalityCode }) => [
            municipalityCode,
            populationValueFor(municipalityCode, year),
          ]),
        )
      : metric === "age"
        ? Object.fromEntries(
            index.municipalities.map(({ municipalityCode }) => [
              municipalityCode,
              activeDemography
                ? valueForCounts(activeDemography.values[municipalityCode])
                : null,
            ]),
          )
        : metric === "movement"
          ? Object.fromEntries(
              index.municipalities.map(({ municipalityCode }) => [
                municipalityCode,
                activeMovement ? movementValueFor(municipalityCode, year) : null,
              ]),
            )
          : Object.fromEntries(
              index.municipalities.map(({ municipalityCode }) => [
                municipalityCode,
                activeCosts ? costValueFor(municipalityCode, year) : null,
              ]),
            );
  const indicatorUnit = indicator ? demographicIndicatorUnit(indicator) : null;
  const indicatorFormatter =
    indicatorUnit === "share" ? shareFormatter : ratioFormatter;
  const indicatorUnitLabel =
    indicatorUnit === "per-100" ? t("per100Persons") : indicatorUnit === "years" ? t("yearsUnit") : "";
  const tooltipValues =
    metric === "population" && populationView !== "count"
      ? Object.fromEntries(
          index.municipalities.map(({ municipalityCode }) => {
            const value = metricValues[municipalityCode];
            return [
              municipalityCode,
              populationViewLabels[populationView] + " · "
                + (value === null ? "—" : populationViewFormatter.format(value) + (populationUnitLabel ? " " + populationUnitLabel : "")),
            ];
          }),
        )
      : metric === "age" && activeDemography
      ? Object.fromEntries(
          index.municipalities.map(({ municipalityCode }) => {
            const counts = activeDemography.values[municipalityCode];
            if (indicator) {
              const value = demographicIndicatorValue(counts, indicator);
              return [
                municipalityCode,
                (
                  indicatorLabels[indicator] +
                  " · " +
                  (value === null ? "—" : indicatorFormatter.format(value)) +
                  " " +
                  (indicatorUnitLabel)
                ).trim(),
              ];
            }
            const persons = demographyValue(counts, sex, ageGroup);
            const denominator = demographyPopulation(counts, sex);
            const share = denominator > 0 ? persons / denominator : null;
            return [
              municipalityCode,
              ageGroupLabels[ageGroup] +
                " · " +
                personsFormatter.format(persons) +
                " " +
                t("populationUnit") +
                " · " +
                (share === null ? "—" : shareFormatter.format(share)) +
                (sex === "female"
                  ? " (" + t("sexFemale") + ")"
                  : sex === "male"
                    ? " (" + t("sexMale") + ")"
                    : ""),
            ];
          }),
        )
      : metric === "movement" && activeMovement
        ? Object.fromEntries(
            index.municipalities.map(({ municipalityCode }) => {
              const value = movementValueFor(municipalityCode, year);
              return [
                municipalityCode,
                movementLabels[movementView] +
                  " · " +
                  (value === null
                    ? "—"
                    : movementFormatter.format(value) +
                      " " +
                      movementUnitLabel),
              ];
            }),
          )
        : metric === "costs" && activeCosts
          ? Object.fromEntries(
              index.municipalities.map(({ municipalityCode }) => {
                const value = metricValues[municipalityCode];
                if (value === null) return [municipalityCode, `${costCategoryLabels[costCategory]} · ${t("costNoData")}`];
                const formatter = costMeasure === "share" || costMeasure === "peer-deviation" ? shareFormatter : currencyFormatter;
                return [municipalityCode, `${costCategoryLabels[costCategory]} · ${costMeasureLabels[costMeasure]} · ${formatter.format(value)}`];
              }),
            )
          : null;
  const selectedPopulation = selected
    ? usesCitizenship
      ? (structureSeries?.years[String(year)]?.values[selected.municipalityCode]?.[0] ?? activePopulation.values[selected.municipalityCode])
      : activePopulation.values[selected.municipalityCode]
    : 0;
  const selectedAgeCounts =
    selected && activeDemography
      ? activeDemography.values[selected.municipalityCode]
      : null;
  const selectedAgePersons =
    selectedAgeCounts && !indicator
      ? demographyValue(selectedAgeCounts, sex, ageGroup)
      : null;
  const selectedAgeDenominator =
    selectedAgeCounts && !indicator
      ? demographyPopulation(selectedAgeCounts, sex)
      : null;
  const selectedAgeShare =
    selectedAgePersons !== null && selectedAgeDenominator
      ? selectedAgePersons / selectedAgeDenominator
      : null;
  const selectedMovementCounts =
    selected && activeMovement
      ? activeMovement.values[selected.municipalityCode]
      : null;
  const statisticalCorrection = selectedMovementCounts
    ? movementStatisticalCorrection(selectedMovementCounts)
    : null;
  const selectedCosts = selected && activeCosts ? (activeCosts.values[selected.municipalityCode] ?? null) : null;
  const selectedCostCents = selectedCosts ? municipalityCostCategoryCents(selectedCosts, costCategory) : null;
  const selectedCostPerCapita = selectedCosts
    ? municipalityCostPerCapita(selectedCosts, costCategory, selectedPopulation)
    : null;
  const selectedPeerMedian = metric === "costs" && selected ? peerMedianFor(selected.municipalityCode, year) : null;
  const previousYear = year > availableFirstYear! ? year - 1 : null;
  const activeValue = selected
    ? (metricValues[selected.municipalityCode] ?? null)
    : null;
  const metricValueForYear = (targetYear: number) =>
    selected
      ? metric === "population"
        ? populationValueFor(selected.municipalityCode, targetYear)
        : metric === "age"
          ? demographySeries
            ? valueForCounts(
                demographySeries.years[String(targetYear)].values[
                  selected.municipalityCode
                ],
              )
            : null
          : metric === "movement"
            ? movementValueFor(selected.municipalityCode, targetYear)
            : costValueFor(selected.municipalityCode, targetYear)
      : null;
  const previousValue =
    previousYear === null ? null : metricValueForYear(previousYear);
  const firstValue = metricValueForYear(availableFirstYear!);
  const historyAvailable =
    (metric === "population" && (!usesCitizenship || structureSeries)) ||
    (metric === "age" && demographySeries) ||
    (metric === "movement" && movementSeries) ||
    (metric === "costs" && costSeries);
  const history =
    selected && historyAvailable
      ? Array.from({ length: availableLatestYear! - availableFirstYear! + 1 }, (_, offset) => availableFirstYear! + offset).map((historyYear) => ({
          year: historyYear,
          value: metricValueForYear(historyYear),
        }))
      : null;
  const chartFormatter =
    metric === "costs"
      ? costMeasure === "share" || costMeasure === "peer-deviation"
        ? shareFormatter
        : currencyFormatter
      : metric === "movement"
      ? movementFormatter
      : metric === "population"
        ? populationViewFormatter
        : !indicator && ageMeasure === "persons"
          ? personsFormatter
        : indicator && (indicatorUnit === "per-100" || indicatorUnit === "years")
          ? ratioFormatter
          : shareFormatter;
  const chartUnit =
    metric === "costs"
      ? costMeasure === "per-capita" || costMeasure === "real-per-capita"
        ? t("costPerInhabitantUnit")
        : ""
      : metric === "movement"
      ? movementUnitLabel
      : metric === "population"
        ? populationUnitLabel
        : !indicator && ageMeasure === "persons"
          ? t("populationUnit")
        : indicatorUnit === "per-100"
          ? t("per100Persons")
          : indicatorUnit === "years"
            ? t("yearsUnit")
            : "";
  const metricLabel =
    metric === "costs"
      ? costCategoryLabels[costCategory] + " · " + costMeasureLabels[costMeasure]
      : metric === "population"
      ? populationViewLabels[populationView]
      : metric === "movement"
        ? movementLabels[movementView]
        : indicator
          ? indicatorLabels[indicator]
          : ageGroupLabels[ageGroup] +
            " · " +
            t(
              ageMeasure === "share" ? "ageMeasureShare" : "ageMeasurePersons",
            ) +
            " · " +
            t(
              sex === "female"
                ? "sexFemale"
                : sex === "male"
                  ? "sexMale"
                  : "sexAll",
            );
  const analysisDataset: MunicipalityDatasetRef | null = !selected
    ? null
    : metric === "costs"
      ? { kind: "cost-share", municipalityCode: selected.municipalityCode, municipalityName: selected.name, category: costCategory, measure: costMeasure }
      : metric === "population"
      ? { kind: "population", municipalityCode: selected.municipalityCode, municipalityName: selected.name, view: populationView }
      : metric === "movement"
        ? { kind: "movement", municipalityCode: selected.municipalityCode, municipalityName: selected.name, metric: movementView }
        : indicator
          ? { kind: "age-indicator", municipalityCode: selected.municipalityCode, municipalityName: selected.name, indicator }
          : { kind: "age-group", municipalityCode: selected.municipalityCode, municipalityName: selected.name, ageGroup, measure: ageMeasure, sex };
  const scaleDomain =
    metric === "costs"
      ? (() => {
          const domain = percentileDomain(Object.values(metricValues).filter((value): value is number => value !== null));
          if (costMeasure !== "peer-deviation") return domain;
          const maximum = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
          return [-maximum, maximum] as [number, number];
        })()
      : metric === "population"
      ? populationView === "count"
        ? null
        : populationView === "density"
          ? densityScale
          : structureSeries?.scales[populationView] ?? null
      : metric === "movement"
      ? (movementSeries?.scales[movementView] ?? null)
      : metric !== "age" || !demographySeries
        ? null
        : indicator
          ? (indicatorScales?.[indicator] ?? null)
          : demographySeries.scales[ageMeasure][sex][ageGroup];
  const formatMetricChange = (
    current: number | null,
    comparison: number | null,
  ) => {
    if (current === null || comparison === null) return "—";
    if (metric === "costs")
      return costMeasure === "share" || costMeasure === "peer-deviation"
        ? signedDecimalFormatter.format((current - comparison) * 100) + " " + t("percentagePoints")
        : formatSigned(current - comparison, currencyFormatter) + " " + t("costPerInhabitantUnit");
    if (metric === "population") {
      if (populationUnit === "share") return signedDecimalFormatter.format((current - comparison) * 100) + " " + t("percentagePoints");
      if (populationUnit === "per-square-kilometer") return signedDecimalFormatter.format(current - comparison) + " " + t("populationDensityUnit");
      return formatSigned(current - comparison, personsFormatter);
    }
    if (metric === "movement")
      return movementUnit === "persons"
        ? formatSigned(current - comparison, personsFormatter)
        : signedDecimalFormatter.format(current - comparison) +
            " " +
            t("per1000Inhabitants");
    if (indicatorUnit === "years") return signedDecimalFormatter.format(current - comparison) + " " + t("yearsUnit");
    if (indicatorUnit === "per-100")
      return (
        signedDecimalFormatter.format(current - comparison) + " " + t("points")
      );
    if (indicatorUnit === "share" || (!indicator && ageMeasure === "share"))
      return (
        signedDecimalFormatter.format((current - comparison) * 100) +
        " " +
        t("percentagePoints")
      );
    return formatSigned(current - comparison, personsFormatter);
  };
  const averageAnnualPopulationChange =
    metric === "population" && populationView === "count" &&
    firstValue &&
    activeValue &&
    year > populationSeries.firstYear
      ? Math.pow(
          activeValue / firstValue,
          1 / (year - populationSeries.firstYear),
        ) - 1
      : null;

  return (
    <div
      className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]"
      data-testid="municipalities-workspace"
    >
      <section
        className="relative h-[60dvh] min-h-[28rem] lg:h-[calc(100dvh-12rem)] lg:min-h-[38rem]"
        aria-label={t("mapRegionLabel")}
      >
        <div className="absolute top-3 left-3 z-20 w-[min(24rem,calc(100%-5.5rem))]">
          <div className="relative rounded-xl border bg-background/95 shadow-lg backdrop-blur">
            <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
                setActiveResult(0);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              aria-controls="municipality-search-results"
              aria-expanded={searchOpen && results.length > 0}
              role="combobox"
              className="h-10 w-full rounded-xl bg-transparent pr-10 pl-9 text-sm outline-none focus:ring-2 focus:ring-teal-600/40"
            />
            {query && (
              <button
                type="button"
                aria-label={t("clearSearch")}
                className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md hover:bg-accent"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
              >
                <X className="size-4" />
              </button>
            )}
            {searchOpen && query && (
              <div
                id="municipality-search-results"
                role="listbox"
                // Opens beside the search box from sm up: dropping straight down covered
                // the Kennzahl/Ansicht/Jahr panel, hiding the settings being compared.
                className="absolute top-[calc(100%+0.4rem)] left-0 max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl sm:top-0 sm:left-[calc(100%+0.5rem)]"
              >
                {results.length ? (
                  results.map((item, position) => (
                    <button
                      key={item.municipalityCode}
                      type="button"
                      role="option"
                      aria-selected={position === activeResult}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${position === activeResult ? "bg-accent" : "hover:bg-accent"}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveResult(position)}
                      onClick={() => updateSelection(item)}
                    >
                      <span>
                        <span className="block font-medium">{item.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {item.state}
                        </span>
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.municipalityCode}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                    {t("noSearchResults")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <MunicipalityMap
          austriaBounds={index.bounds}
          selected={selected}
          metric={metric}
          populationView={populationView}
          populationDefinition={populationViewDefinitions[populationView] ?? null}
          usePopulationClasses={metric === "population" && populationView === "count"}
          metricValues={metricValues}
          tooltipValues={tooltipValues}
          scaleDomain={scaleDomain}
          movementPalette={
            metric === "movement" ? movementMetricPalette(movementView) : null
          }
          year={year}
          firstYear={availableFirstYear!}
          latestYear={availableLatestYear!}
          ageView={ageView}
          ageMeasure={ageMeasure}
          sex={sex}
          movementView={movementView}
          costCategory={costCategory}
          costMeasure={costMeasure}
          peerMunicipalityCodes={selectedPeerGroup?.municipalityCodes ?? null}
          peerGroupLabel={selectedPeerGroup?.label ?? null}
          movementDefinition={movementDefinitions[movementView] ?? null}
          showAgeFilters={!indicator}
          indicatorDefinition={
            indicator ? indicatorDefinitions[indicator] : null
          }
          ageLoading={metric === "age" && !demographySeries && !demographyError}
          ageError={demographyError}
          movementLoading={
            metric === "movement" && !movementSeries && !movementError
          }
          movementError={movementError}
          costsLoading={metric === "costs" && !costSeries && !costError}
          costsError={costError}
          structureLoading={usesCitizenship && !structureSeries && !structureError}
          structureError={structureError}
          onYearChange={(value) =>
            setParameter("populationYear", String(value))
          }
          onMetricChange={updateMetric}
          onPopulationViewChange={updatePopulationView}
          onAgeViewChange={updateAgeView}
          onAgeMeasureChange={(value) => setParameter("ageMeasure", value)}
          onSexChange={(value) => setParameter("sex", value)}
          onMovementViewChange={(value) =>
            setParameter("movementMetric", value)
          }
          onCostCategoryChange={(value) => setParameter("costCategory", value === "0" ? null : value)}
          onCostMeasureChange={(value) => setParameter("costMeasure", value === "share" ? null : value)}
          onSelect={selectByCode}
          onReset={() => updateSelection(null)}
          labels={{
            map: t("mapLabel"),
            zoomIn: t("zoomIn"),
            zoomOut: t("zoomOut"),
            reset: t("allAustria"),
            municipalityCode: t("municipalityCode"),
            population: t("population"),
            reference:
              metric === "costs"
                ? t("costReference", { year })
                : metric === "movement"
                ? t("movementReference", { year })
                : usesCitizenship
                  ? t("structureReference", { year })
                  : t("populationReference", { year }),
            year: t("populationYear"),
            previousYear: t("previousPopulationYear"),
            nextYear: t("nextPopulationYear"),
            metric: t("metric"),
            populationMetric: t("metricPopulation"),
            ageMetric: t("metricAge"),
            movementMetric: t("metricMovement"),
            costsMetric: t("metricCosts"),
            populationView: t("populationView"),
            populationViews: populationViewLabels,
            ageView: t("ageView"),
            movementView: t("movementView"),
            ageGroupsHeading: t("ageGroupsHeading"),
            indicatorsHeading: t("indicatorsHeading"),
            ageGroups: ageGroupLabels,
            indicators: indicatorLabels,
            measures: {
              share: t("ageMeasureShare"),
              persons: t("ageMeasurePersons"),
            },
            movements: movementLabels,
            costView: t("costView"),
            costCategories: costCategoryLabels,
            costMeasure: t("costMeasure"),
            costMeasures: costMeasureLabels,
            costDefinition: costMeasureDefinitions[costMeasure],
            sexes: {
              all: t("sexAll"),
              female: t("sexFemale"),
              male: t("sexMale"),
            },
            minimizeChart: t("minimizeMetricChart"),
            expandChart: t("expandMetricChart"),
            loadingAge: t("ageLayerLoading"),
            ageError: t("ageLayerError"),
            loadingMovement: t("movementLayerLoading"),
            movementError: t("movementLayerError"),
            loadingCosts: t("costLayerLoading"),
            costsError: t("costLayerError"),
            loadingStructure: t("structureLayerLoading"),
            structureError: t("structureLayerError"),
            addToAnalysis: t("addToAnalysis"),
            dragToAnalysis: t("dragToAnalysis"),
            noData: t("mapNoData"),
            zoomHintWindows: t("mapZoomHintWindows"),
            zoomHintMac: t("mapZoomHintMac"),
            zoomHintMobile: t("mapZoomHintMobile"),
          }}
          selectedMetricHistory={history}
          metricChartLabel={
            selected
              ? metric === "costs"
                ? t("costChartLabel", { municipality: selected.name, category: metricLabel })
                : metric === "population"
                ? populationView === "count"
                  ? t("populationChartLabel", { municipality: selected.name })
                  : t("populationViewChartLabel", { municipality: selected.name, metric: metricLabel })
                : metric === "movement"
                  ? t("movementChartLabel", {
                      municipality: selected.name,
                      metric: metricLabel,
                    })
                  : t("ageChartLabel", {
                      municipality: selected.name,
                      ageGroup: metricLabel,
                    })
              : ""
          }
          metricLabel={metricLabel}
          chartValueFormatter={chartFormatter}
          chartUnitLabel={chartUnit}
          chartChangeLabels={metric === "population" && populationView === "count" ? { previousYear: t("populationChangePreviousYear"), sinceFirstYear: t("populationChangeSinceFirstYear", { year: populationSeries.firstYear }) } : undefined}
          analysisDataset={analysisDataset}
        />
      </section>
      <aside
        className="flex flex-col gap-4"
        aria-live="polite"
        data-testid="municipality-details"
      >
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          {selected ? (
            <>
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                <MapPinned className="size-5" />
              </div>
              <p className="text-xs font-semibold tracking-[0.14em] text-teal-700 uppercase dark:text-teal-300">
                {t("selectedMunicipality")}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                {selected.name}
              </h2>
              <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("state")}</dt><dd className="font-medium">{selected.state}</dd>
                <dt className="text-muted-foreground">{t("district")}</dt><dd className="font-medium">{selectedProfile?.district ?? t("profileDataUnavailable")}</dd>
                <dt className="text-muted-foreground">{t("population")}</dt><dd className="font-semibold tabular-nums">{personsFormatter.format(selectedPopulation)}</dd>
                <dt className="text-muted-foreground">{t("mayor")}</dt><dd className="font-medium">{selectedProfile?.mayor ?? t("profileDataUnavailable")}</dd>
                <dt className="text-muted-foreground">{t("councilComposition")}</dt><dd className="font-medium">{selectedProfile?.councilComposition ?? t("profileDataUnavailable")}</dd>
                <dt className="text-muted-foreground">{t("officialWebsite")}</dt><dd className="min-w-0 font-medium">{selectedProfile?.officialWebsite ? <a className="break-all text-teal-700 underline underline-offset-2 hover:text-teal-800" href={selectedProfile.officialWebsite} target="_blank" rel="noreferrer">{t("openWebsite")}</a> : t("profileDataUnavailable")}</dd>
              </dl>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" />
                {metric === "costs"
                  ? t("costReference", { year })
                  : metric === "movement"
                  ? t("movementReference", { year })
                  : usesCitizenship
                    ? t("structureReference", { year })
                    : t("populationReference", { year })}
              </p>
              {investmentMunicipalityCodes?.has(selected.municipalityCode) && (
                <Button
                  variant="outline"
                  className="mt-5 w-full"
                  render={<Link href={`/municipalities/${selected.municipalityCode}/investments`} />}
                >
                  <Landmark className="size-4" />
                  {t("investmentDetails")}
                </Button>
              )}
              <Button
                variant="outline"
                className={investmentMunicipalityCodes?.has(selected.municipalityCode) ? "mt-2 w-full" : "mt-5 w-full"}
                onClick={() => updateSelection(null)}
              >
                <X className="size-4" />
                {t("clearSelection")}
              </Button>
            </>
          ) : (
            <>
              <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <MapPinned className="size-5" />
              </div>
              <h2 className="font-semibold">{t("selectionTitle")}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("selectionDescription")}
              </p>
            </>
          )}
        </div>
        <div className="rounded-2xl border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
          <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
            <Database className="size-4" />
            {t("dataBasis")}
          </div>
          <p>{t("dataBasisDescription", { count: index.count })}</p>
          <p className="mt-2">
            {t("populationDataBasis", {
              firstYear: populationSeries.firstYear,
              latestYear: populationSeries.latestYear,
            })}{" "}
            <a
              className="underline underline-offset-2 hover:text-foreground"
              href={populationSeries.source.urlTemplate.replace(
                "{year}",
                String(populationSeries.latestYear),
              )}
              target="_blank"
              rel="noreferrer"
            >
              {populationSeries.source.title}
            </a>
            {` (${populationSeries.source.license}).`}
          </p>
          {demographySeries && (
            <p className="mt-2">
              {t("ageDataBasis", {
                firstYear: demographySeries.firstYear,
                latestYear: demographySeries.latestYear,
              })}
            </p>
          )}
          {structureSeries && (
            <p className="mt-2">
              {t("structureDataBasis", {
                firstYear: structureSeries.firstYear,
                latestYear: structureSeries.latestYear,
              })}{" "}
              <a
                className="underline underline-offset-2 hover:text-foreground"
                href={structureSeries.source.url}
                target="_blank"
                rel="noreferrer"
              >
                {structureSeries.source.title}
              </a>
              {" (" + structureSeries.source.license + ")."}
            </p>
          )}
          {movementSeries && (
            <p className="mt-2">
              {t("movementDataBasis", {
                firstYear: movementSeries.firstYear,
                latestYear: movementSeries.latestYear,
              })}{" "}
              <a
                className="underline underline-offset-2 hover:text-foreground"
                href={movementSeries.source.url}
                target="_blank"
                rel="noreferrer"
              >
                {movementSeries.source.title}
              </a>
              {" (" + movementSeries.source.license + ")."}
            </p>
          )}
          {costSeries && (
            <>
              <p className="mt-2">
                {t("costDataBasis", { firstYear: costSeries.firstYear, latestYear: costSeries.latestYear })}{" "}
                <a className="underline underline-offset-2 hover:text-foreground" href={costSeries.source.url} target="_blank" rel="noreferrer">
                  {costSeries.source.title}
                </a>.
              </p>
              {costMeasure === "real-per-capita" && (
                <p className="mt-2">
                  {t("costInflationDataBasis")}{" "}
                  <a className="underline underline-offset-2 hover:text-foreground" href="https://www.statistik.at/statistiken/volkswirtschaft-und-oeffentliche-finanzen/preise-und-preisindizes/verbraucherpreisindex-vpi/hvpi" target="_blank" rel="noreferrer">
                    Statistik Austria
                  </a>.
                </p>
              )}
              {metric === "costs" && <p className="mt-2">{t("costUnavailableNet")}</p>}
            </>
          )}
          <p className="mt-2">{t("geometryAttribution")}</p>
        </div>
      </aside>
    </div>
  );
}
