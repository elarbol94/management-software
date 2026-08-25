"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Database, Landmark, MapPinned, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileBottomSheet } from "@/components/ui/mobile-bottom-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { MunicipalityMetricChart } from "./municipality-metric-chart";
import { MunicipalityDigitalPlatformsPanel } from "./municipality-digital-platforms-panel";
import { MunicipalityPoliticsPanel } from "./municipality-politics-panel";
import type { MunicipalityDatasetRef } from "../analysis";
import {
  COST_CATEGORIES,
  MUNICIPALITY_COSTS_FIRST_YEAR,
  MUNICIPALITY_COSTS_LATEST_YEAR,
  isCostCategoryId,
  isCostMeasureId,
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
  digitalPlatformCostEstimate,
  digitalPlatformMetricValue,
  digitalPlatformProviderClassification,
  isDigitalPlatformViewId,
  validateMunicipalityDigitalPlatformDataset,
  type DigitalPlatformViewId,
  type DigitalPlatformProviderCategory,
  type MunicipalityDigitalPlatformDataset,
  type MunicipalityDigitalPlatformProfile,
} from "../digital-platforms";
import {
  demographicIndicatorUnit,
  demographicIndicatorValue,
  demographyMetricValue,
  demographyPopulation,
  demographyValue,
  isAgeGroupId,
  isDemographicIndicatorId,
  datasetDomain,
  symmetricDomain,
  validateMunicipalityDemographySeries,
  type AgeGroupId,
  type AgeMeasure,
  type AgeViewId,
  type DemographicIndicatorId,
  type MapMetric,
  type MunicipalityDemographySeries,
  type SexFilter,
} from "../demography";
import {
  isMovementMetricId,
  movementMetricPalette,
  movementMetricUnit,
  movementMetricValue,
  validateMunicipalityMovementSeries,
  type MovementMetricId,
  type MunicipalityMovementSeries,
} from "../movement";
import {
  CANONICAL_PARTIES,
  POLITICS_FIRST_YEAR,
  POLITICS_LATEST_YEAR,
  electionAsOf,
  leadingElectionList,
  politicsMapValue,
  isCanonicalPartyId,
  isPoliticsView,
  validateMunicipalityCurrentPolitics,
  validateMunicipalityElectionHistory,
  type CanonicalPartyId,
  type MunicipalityCurrentPoliticsDataset,
  type MunicipalityElectionHistoryDataset,
  type PoliticsView,
} from "../politics";
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

type DatasetSelection = {
  metric: MapMetric;
  populationView: PopulationViewId;
  ageView: AgeViewId;
  ageMeasure: AgeMeasure;
  sex: SexFilter;
  movementView: MovementMetricId;
  costCategory: CostCategoryId;
  costMeasure: CostMeasureId;
};
type DatasetSeries = {
  index: MunicipalityIndex;
  population: MunicipalityPopulationSeries;
  structure: MunicipalityStructureSeries | null;
  demography: MunicipalityDemographySeries | null;
  movement: MunicipalityMovementSeries | null;
  costs: MunicipalityCostSeries | null;
};

/**
 * One `(code, year) => value` reader for the selected dataset, plus its own peer-median
 * cache. Both the map's per-year values and the colour domain go through it, so the
 * domain can never be computed from a different definition than the map paints.
 */
function createDatasetLookup(selection: DatasetSelection, data: DatasetSeries) {
  const { metric, populationView, ageView, ageMeasure, sex, movementView, costCategory, costMeasure } = selection;
  const { index, population, structure, demography, movement, costs } = data;
  const byCode = new Map(index.municipalities.map((item) => [item.municipalityCode, item]));
  const indicator = isDemographicIndicatorId(ageView) ? ageView : null;
  const ageGroup = indicator ? "0-5" as AgeGroupId : ageView as AgeGroupId;
  const peerMedians = new Map<number, Map<string, number | null>>();

  const peerMedianFor = (code: string, year: number) => {
    let medians = peerMedians.get(year);
    if (!medians) {
      const groups = new Map<string, number[]>();
      const yearCosts = costs?.years[String(year)]?.values ?? {};
      const populations = population.years[String(year)]?.values ?? {};
      for (const municipality of index.municipalities) {
        const inhabitants = populations[municipality.municipalityCode];
        const tuple = yearCosts[municipality.municipalityCode];
        if (!tuple || !inhabitants) continue;
        const value = municipalityCostPerCapita(tuple, costCategory, inhabitants);
        if (value === null) continue;
        const band = municipalityPopulationBand(inhabitants);
        for (const key of [municipality.state + "|" + band, "*|" + band]) {
          const group = groups.get(key);
          if (group) group.push(value);
          else groups.set(key, [value]);
        }
      }
      medians = new Map();
      for (const municipality of index.municipalities) {
        const inhabitants = populations[municipality.municipalityCode];
        const band = municipalityPopulationBand(inhabitants);
        const regional = groups.get(municipality.state + "|" + band);
        const comparison = regional && regional.length >= 5 ? regional : groups.get("*|" + band) ?? [];
        medians.set(municipality.municipalityCode, median(comparison));
      }
      peerMedians.set(year, medians);
    }
    return medians.get(code) ?? null;
  };

  const valueFor = (code: string, year: number): number | null => {
    const key = String(year);
    if (metric === "population") {
      const municipality = byCode.get(code);
      const inhabitants = population.years[key]?.values[code];
      if (!municipality || inhabitants === undefined) return null;
      return populationViewValue(populationView, inhabitants, municipality, structure?.years[key]?.values[code] ?? null);
    }
    if (metric === "age") {
      const counts = demography?.years[key]?.values[code];
      if (!counts) return null;
      return indicator
        ? demographicIndicatorValue(counts, indicator)
        : demographyMetricValue(counts, sex, ageGroup, ageMeasure);
    }
    if (metric === "movement") {
      const counts = movement?.years[key]?.values[code];
      const inhabitants = population.years[key]?.values[code];
      if (!counts || inhabitants === undefined) return null;
      return movementMetricValue(counts, inhabitants, movementView);
    }
    const tuple = costs?.years[key]?.values[code];
    if (!tuple) return null;
    if (costMeasure === "share") return municipalityCostShare(tuple, costCategory);
    const inhabitants = population.years[key]?.values[code];
    if (inhabitants === undefined) return null;
    if (costMeasure === "real-per-capita") {
      return municipalityCostRealPerCapita(tuple, costCategory, inhabitants, year);
    }
    const perCapita = municipalityCostPerCapita(tuple, costCategory, inhabitants);
    if (costMeasure === "per-capita") return perCapita;
    const peerMedian = peerMedianFor(code, year);
    return perCapita !== null && peerMedian && peerMedian > 0 ? perCapita / peerMedian - 1 : null;
  };

  /** The years the selected dataset actually covers. */
  const years = () => {
    const series = metric === "age" ? demography : metric === "movement" ? movement : metric === "costs" ? costs : population;
    return series ? Object.keys(series.years).map(Number) : [];
  };

  return { valueFor, peerMedianFor, years };
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
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }),
    [locale],
  );
  const digitalCostFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
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
  const [digitalPlatforms, setDigitalPlatforms] = useState<MunicipalityDigitalPlatformDataset | null>(null);
  const [investmentMunicipalityCodes, setInvestmentMunicipalityCodes] = useState<Set<string> | null>(null);
  const [profiles, setProfiles] = useState<MunicipalityProfileDataset | null>(null);
  const [currentPolitics, setCurrentPolitics] = useState<MunicipalityCurrentPoliticsDataset | null>(null);
  const [electionHistory, setElectionHistory] = useState<MunicipalityElectionHistoryDataset | null>(null);
  const [politicsError, setPoliticsError] = useState(false);
  const [politicsHistoryRequested, setPoliticsHistoryRequested] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [demographyError, setDemographyError] = useState(false);
  const [movementError, setMovementError] = useState(false);
  const [structureError, setStructureError] = useState(false);
  const [costError, setCostError] = useState(false);
  const [digitalPlatformsError, setDigitalPlatformsError] = useState(false);
  const digitalReferenceDate = dateFormatter.format(new Date(`${digitalPlatforms?.referenceDate ?? "2026-08-25"}T00:00:00`));
  const paramsRef = useRef(searchParams.toString());
  useEffect(() => {
    paramsRef.current = searchParams.toString();
  }, [searchParams]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const populationViewParameter = searchParams.get("populationView") ?? "count";
  const populationView: PopulationViewId = isPopulationViewId(populationViewParameter)
    ? populationViewParameter
    : "count";
  const metricParameter = searchParams.get("metric");
  const metric: MapMetric =
    metricParameter === "age" || metricParameter === "movement" || metricParameter === "costs" || metricParameter === "politics" || metricParameter === "digital"
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
  const politicsViewParameter = searchParams.get("politicsView") ?? "leading-list";
  const politicsView: PoliticsView = isPoliticsView(politicsViewParameter) ? politicsViewParameter : "leading-list";
  const politicsPartyParameter = searchParams.get("politicsParty") ?? "oevp";
  const politicsParty: CanonicalPartyId = isCanonicalPartyId(politicsPartyParameter) ? politicsPartyParameter : "oevp";
  const digitalViewParameter = searchParams.get("digitalView") ?? "overview";
  const digitalView: DigitalPlatformViewId = isDigitalPlatformViewId(digitalViewParameter) ? digitalViewParameter : "overview";
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
  const selectedCurrentPolitics = selected ? (currentPolitics?.municipalities[selected.municipalityCode] ?? null) : null;
  const selectedElectionHistory = selected ? (electionHistory?.municipalities[selected.municipalityCode]?.events ?? null) : null;
  const selectedDigitalPlatforms = selected ? (digitalPlatforms?.municipalities[selected.municipalityCode] ?? null) : null;
  const availableFirstYear = metric === "digital" ? 2026
    : metric === "politics" ? POLITICS_FIRST_YEAR
    : metric === "costs"
    ? MUNICIPALITY_COSTS_FIRST_YEAR
    : usesCitizenship ? MUNICIPALITY_STRUCTURE_FIRST_YEAR : populationSeries?.firstYear;
  const availableLatestYear = metric === "digital" ? 2026
    : metric === "politics" ? POLITICS_LATEST_YEAR
    : metric === "costs"
    ? MUNICIPALITY_COSTS_LATEST_YEAR
    : usesCitizenship ? MUNICIPALITY_STRUCTURE_LATEST_YEAR : populationSeries?.latestYear;
  const year = useMemo(() => {
    if (metric === "digital") return 2026;
    const value = Number(searchParams.get(metric === "politics" ? "politicsYear" : "populationYear"));
    return populationSeries && availableFirstYear !== undefined && availableLatestYear !== undefined &&
      Number.isInteger(value) && value >= availableFirstYear && value <= availableLatestYear
      ? value
      : (availableLatestYear ?? null);
  }, [availableFirstYear, availableLatestYear, metric, populationSeries, searchParams]);
  const populationReferenceYear = year === null || !populationSeries ? null : Math.min(populationSeries.latestYear, Math.max(populationSeries.firstYear, year));
  const activePopulation = populationReferenceYear === null ? null : (populationSeries?.years[String(populationReferenceYear)] ?? null);
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
  const politicsViewLabels: Record<PoliticsView, string> = {
    "leading-list": t("politicsViewLeadingList"),
    "party-share": t("politicsViewPartyShare"),
    turnout: t("politicsViewTurnout"),
  };
  const politicsPartyLabels = Object.fromEntries(CANONICAL_PARTIES.map((party) => [party, t(`politicsParty${party}` as "politicsPartyoevp")])) as Record<CanonicalPartyId, string>;
  const digitalViewLabels: Record<DigitalPlatformViewId, string> = {
    overview: t("digitalViewOverview"),
    providers: t("digitalViewProviders"),
    "citizen-app": t("digitalViewCitizenApp"),
    "service-portal": t("digitalViewServicePortal"),
    "digital-notice-board": t("digitalViewNoticeBoard"),
    "website-cms": t("digitalViewWebsiteCms"),
    "waste-platform": t("digitalViewWastePlatform"),
    "appointment-booking": t("digitalViewAppointmentBooking"),
    participation: t("digitalViewParticipation"),
    communication: t("digitalViewCommunication"),
    "open-data": t("digitalViewOpenData"),
    other: t("digitalViewOther"),
  };
  const digitalProviderLabels: Record<DigitalPlatformProviderCategory, string> = {
    none: t("digitalProviderNone"),
    gem2go: "GEM2GO",
    cities: "CITIES",
    gemeinde24: "Gemeinde24",
    gemeindeapp: "GemeindeApp",
    "daheim-app": "Daheim App",
    "local-app": t("digitalProviderLocal"),
    multiple: t("digitalProviderMultiple"),
  };
  const digitalProviderDescription = (
    profile: MunicipalityDigitalPlatformProfile | undefined,
  ) => {
    if (!profile) return t("digitalCoverageUnknown");
    const classification = digitalPlatformProviderClassification(profile);
    if (!classification) return t("digitalCoverageUnknown");
    if (classification.category !== "multiple") {
      return digitalProviderLabels[classification.category];
    }
    return `${digitalProviderLabels.multiple} · ${classification.providers
      .map((provider) => digitalProviderLabels[provider]).join(", ")}`;
  };
  const formatDigitalCostRange = (range: readonly [number, number]) =>
    range[0] === range[1]
      ? digitalCostFormatter.format(range[0])
      : `${digitalCostFormatter.format(range[0])}–${digitalCostFormatter.format(range[1])}`;
  const digitalProviderCostDescription = (
    profile: MunicipalityDigitalPlatformProfile | undefined,
    population: number | undefined,
  ) => {
    if (!profile || !population) return t("digitalCostUnavailable");
    const estimate = digitalPlatformCostEstimate(profile, population);
    if (!estimate) return t("digitalCostUnavailable");
    if (estimate.annualEuros[0] === 0 && estimate.annualEuros[1] === 0) {
      return t("digitalCostNoApp");
    }
    return t("digitalCostAnnualShort", { range: formatDigitalCostRange(estimate.annualEuros) });
  };
  const renderDigitalCostMethodology = () => (
    <p className="mt-3 text-[11px] leading-4 text-muted-foreground" data-testid="digital-cost-methodology">
      {t("digitalCostMethodology")} {t("digitalCostSources")}:{" "}
      <a className="text-teal-700 underline underline-offset-2 dark:text-teal-300" href="https://cdn.citiesapps.com/pages/f8f520c0e306b26e1627e156/page-file-system/1706179605834_NiederschriftGR16.06.2023.pdf" target="_blank" rel="noreferrer">{t("digitalCostPublicOffers")}</a>,{" "}
      <a className="text-teal-700 underline underline-offset-2 dark:text-teal-300" href="https://citiesapps.com/help-center/faq/faq-cities-und-municipalities" target="_blank" rel="noreferrer">CITIES</a>,{" "}
      <a className="text-teal-700 underline underline-offset-2 dark:text-teal-300" href="https://gemeindeapp.at/faq/" target="_blank" rel="noreferrer">GemeindeApp</a>,{" "}
      <a className="text-teal-700 underline underline-offset-2 dark:text-teal-300" href="https://daheim-app.at/" target="_blank" rel="noreferrer">Daheim App</a>.
    </p>
  );
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
  // The colour domain belongs to the dataset, not to the displayed year: it is computed
  // once per selection over every year the dataset covers, so dragging the year slider
  // keeps the scale — and therefore the colours — comparable.
  const dataset = useMemo(() => {
    if (!index || !populationSeries) return null;
    if (metric === "digital") {
      const valueFor = (code: string) => digitalPlatformMetricValue(digitalPlatforms?.municipalities[code], digitalView);
      return { valueFor, peerMedianFor: () => null, years: () => [2026], domain: [0, 8] as [number, number] };
    }
    if (metric === "politics") {
      const valueFor = (code: string, targetYear: number) => politicsMapValue(electionAsOf(electionHistory?.municipalities[code]?.events ?? [], targetYear), politicsView, politicsParty);
      return { valueFor, peerMedianFor: () => null, years: () => Array.from({ length: POLITICS_LATEST_YEAR - POLITICS_FIRST_YEAR + 1 }, (_, offset) => POLITICS_FIRST_YEAR + offset), domain: politicsView === "leading-list" ? null : [0, 1] as [number, number] };
    }
    const lookup = createDatasetLookup(
      { metric, populationView, ageView, ageMeasure, sex, movementView, costCategory, costMeasure },
      {
        index,
        population: populationSeries,
        structure: structureSeries,
        demography: demographySeries,
        movement: movementSeries,
        costs: costSeries,
      },
    );
    const usesPopulationClasses = metric === "population" && populationView === "count";
    if (usesPopulationClasses) return { ...lookup, domain: null };
    const years = lookup.years();
    const values = new Float64Array(years.length * index.municipalities.length);
    let count = 0;
    for (const year of years) {
      for (const { municipalityCode } of index.municipalities) {
        const value = lookup.valueFor(municipalityCode, year);
        if (value !== null && Number.isFinite(value)) values[count++] = value;
      }
    }
    const collected = values.subarray(0, count);
    const diverging = (metric === "movement" && movementMetricPalette(movementView) === "diverging")
      || (metric === "costs" && costMeasure === "peer-deviation");
    return { ...lookup, domain: diverging ? symmetricDomain(collected) : datasetDomain(collected) };
  }, [
    ageMeasure, ageView, costCategory, costMeasure, costSeries, demographySeries, index,
    digitalPlatforms, digitalView, electionHistory, metric, movementSeries, movementView, politicsParty, politicsView, populationSeries, populationView, sex, structureSeries,
  ]);

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
    if (!selected || currentPolitics || !index) return;
    const controller = new AbortController();
    fetchJson<MunicipalityCurrentPoliticsDataset>("/data/municipality-politics-current-2026.json", controller.signal)
      .then((data) => setCurrentPolitics(validateMunicipalityCurrentPolitics(data, index.municipalities.map(({ municipalityCode }) => municipalityCode))))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setPoliticsError(true); });
    return () => controller.abort();
  }, [currentPolitics, index, selected]);
  useEffect(() => {
    if ((metric !== "politics" && !politicsHistoryRequested) || electionHistory || politicsError || !index) return;
    const controller = new AbortController();
    fetchJson<MunicipalityElectionHistoryDataset>("/data/municipality-election-history-2000-2026.json", controller.signal)
      .then((data) => setElectionHistory(validateMunicipalityElectionHistory(data, index.municipalities.map(({ municipalityCode }) => municipalityCode))))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setPoliticsError(true); });
    return () => controller.abort();
  }, [electionHistory, index, metric, politicsError, politicsHistoryRequested]);
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

  useEffect(() => {
    if (metric !== "digital" || digitalPlatforms || digitalPlatformsError || !index) return;
    const controller = new AbortController();
    fetchJson<MunicipalityDigitalPlatformDataset>(
      "/data/municipality-digital-platforms.json",
      controller.signal,
    )
      .then((data) => setDigitalPlatforms(validateMunicipalityDigitalPlatformDataset(
        data,
        index.municipalities.map(({ municipalityCode }) => municipalityCode),
      )))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setDigitalPlatformsError(true);
      });
    return () => controller.abort();
  }, [digitalPlatforms, digitalPlatformsError, index, metric]);

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

  const valueFor = dataset!.valueFor;
  const activeDemography = demographySeries?.years[String(year)] ?? null;
  const activeMovement = movementSeries?.years[String(year)] ?? null;
  const activeCosts = costSeries?.years[String(year)] ?? null;
  const populationUnit = populationViewUnit(populationView);
  const populationViewFormatter =
    populationUnit === "persons" ? personsFormatter : populationUnit === "share" ? shareFormatter : ratioFormatter;
  const populationUnitLabel =
    populationUnit === "persons" ? t("populationUnit") : populationUnit === "share" ? "" : t("populationDensityUnit");
  const movementUnit = movementMetricUnit(movementView);
  const movementFormatter =
    movementUnit === "persons" ? personsFormatter : ratioFormatter;
  const movementUnitLabel =
    movementUnit === "persons" ? t("populationUnit") : t("per1000Inhabitants");
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

  const metricValues: Record<string, number | null> = Object.fromEntries(
    index.municipalities.map(({ municipalityCode }) => [
      municipalityCode,
      valueFor(municipalityCode, year),
    ]),
  );
  const indicatorUnit = indicator ? demographicIndicatorUnit(indicator) : null;
  const indicatorFormatter =
    indicatorUnit === "share" ? shareFormatter : ratioFormatter;
  const indicatorUnitLabel =
    indicatorUnit === "per-100" ? t("per100Persons") : indicatorUnit === "years" ? t("yearsUnit") : "";
  const tooltipValues =
    metric === "digital"
      ? Object.fromEntries(index.municipalities.map(({ municipalityCode }) => {
          const value = metricValues[municipalityCode];
          const label = digitalView === "providers"
            ? `${digitalProviderDescription(digitalPlatforms?.municipalities[municipalityCode])} · ${digitalProviderCostDescription(
                digitalPlatforms?.municipalities[municipalityCode],
                activePopulation.values[municipalityCode],
              )}`
            : value === null
              ? t("digitalCoverageUnknown")
              : value === 0
                ? t("digitalNoneFound")
                : digitalView === "overview"
                  ? t("digitalTooltipAreas", { count: value })
                  : t("digitalTooltipPlatforms", { count: value });
          return [municipalityCode, digitalViewLabels[digitalView] + " · " + label];
        }))
      : metric === "population" && populationView !== "count"
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
              const value = valueFor(municipalityCode, year);
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
          : metric === "politics"
            ? Object.fromEntries(index.municipalities.map(({ municipalityCode }) => {
                const event = electionAsOf(electionHistory?.municipalities[municipalityCode]?.events ?? [], year);
                if (!event) return [municipalityCode, t("politicsOfficialCoverageMissing")];
                const turnout = event.eligibleVoters && event.ballotsCast !== null ? shareFormatter.format(event.ballotsCast / event.eligibleVoters) : "—";
                if (politicsView === "turnout") return [municipalityCode, `${event.date} · ${politicsViewLabels.turnout} · ${turnout}`];
                if (politicsView === "party-share") { const value = politicsMapValue(event, politicsView, politicsParty); return [municipalityCode, `${event.date} · ${politicsPartyLabels[politicsParty]} · ${value === null ? "—" : shareFormatter.format(value)} · ${politicsViewLabels.turnout} ${turnout}`]; }
                const leading = leadingElectionList(event);
                if (leading.kind === "missing") return [municipalityCode, `${event.date} · —`];
                if (leading.kind === "tie") return [municipalityCode, `${event.date} · ${t("politicsTie")} · ${politicsViewLabels.turnout} ${turnout}`];
                const aggregation = event.aggregationStatus === "aggregated-predecessors" ? ` · ${t("politicsAggregated")}` : "";
                return [municipalityCode, `${event.date} · ${leading.list.name} · ${event.validVotes ? shareFormatter.format(leading.list.votes / event.validVotes) : "—"} · ${politicsViewLabels.turnout} ${turnout}${aggregation}`];
              }))
            : null;
  const selectedPopulation = selected
    ? usesCitizenship
      ? (structureSeries?.years[String(year)]?.values[selected.municipalityCode]?.[0] ?? activePopulation.values[selected.municipalityCode])
      : activePopulation.values[selected.municipalityCode]
    : 0;
  const selectedDigitalCostEstimate = selectedDigitalPlatforms && selectedPopulation
    ? digitalPlatformCostEstimate(selectedDigitalPlatforms, selectedPopulation)
    : null;
  const previousYear = year > availableFirstYear! ? year - 1 : null;
  const activeValue = selected
    ? (metricValues[selected.municipalityCode] ?? null)
    : null;
  const metricValueForYear = (targetYear: number) =>
    selected ? valueFor(selected.municipalityCode, targetYear) : null;
  const previousValue =
    metric === "politics" || metric === "digital" || previousYear === null ? null : metricValueForYear(previousYear);
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
    metric === "digital" ? personsFormatter
    : metric === "politics" ? shareFormatter
    : metric === "costs"
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
    metric === "digital" ? (digitalView === "providers" ? "" : digitalView === "overview" ? t("digitalAreasUnit", { count: activeValue ?? 0 }) : t("digitalPlatformsUnit", { count: activeValue ?? 0 }))
    : metric === "politics" ? ""
    : metric === "costs"
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
    metric === "digital" ? digitalViewLabels[digitalView]
    : metric === "politics" ? politicsView === "party-share" ? `${politicsViewLabels[politicsView]} · ${politicsPartyLabels[politicsParty]}` : politicsViewLabels[politicsView]
    : metric === "costs"
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
  const metricChartLabel = selected
    ? metric === "digital" ? ""
      : metric === "politics" ? ""
      : metric === "costs"
      ? t("costChartLabel", { municipality: selected.name, category: metricLabel })
      : metric === "population"
        ? populationView === "count"
          ? t("populationChartLabel", { municipality: selected.name })
          : t("populationViewChartLabel", { municipality: selected.name, metric: metricLabel })
        : metric === "movement"
          ? t("movementChartLabel", { municipality: selected.name, metric: metricLabel })
          : t("ageChartLabel", { municipality: selected.name, ageGroup: metricLabel })
    : "";
  const analysisDataset: MunicipalityDatasetRef | null = !selected || metric === "politics" || metric === "digital"
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
  const scaleDomain = dataset!.domain;
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
      className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-4"
      data-testid="municipalities-workspace"
    >
      <section
        className="relative h-[calc(100dvh-10.5rem)] min-h-[32rem] lg:h-[calc(100dvh-12rem)] lg:min-h-[38rem]"
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
          politicsView={politicsView}
          politicsParty={politicsParty}
          digitalView={digitalView}
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
          politicsLoading={metric === "politics" && !electionHistory && !politicsError}
          politicsError={politicsError}
          digitalLoading={metric === "digital" && !digitalPlatforms && !digitalPlatformsError}
          digitalError={digitalPlatformsError}
          structureLoading={usesCitizenship && !structureSeries && !structureError}
          structureError={structureError}
          onYearChange={(value) =>
            setParameter(metric === "politics" ? "politicsYear" : "populationYear", String(value))
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
          onPoliticsViewChange={(value) => setParameter("politicsView", value === "leading-list" ? null : value)}
          onPoliticsPartyChange={(value) => setParameter("politicsParty", value === "oevp" ? null : value)}
          onDigitalViewChange={(value) => setParameter("digitalView", value === "overview" ? null : value)}
          onSelect={selectByCode}
          onReset={() => updateSelection(null)}
          onOpenDetails={() => setDetailsOpen(true)}
          labels={{
            map: t("mapLabel"),
            zoomIn: t("zoomIn"),
            zoomOut: t("zoomOut"),
            reset: t("allAustria"),
            municipalityCode: t("municipalityCode"),
            population: t("population"),
            reference:
              metric === "digital" ? t("digitalReference", { date: digitalReferenceDate })
              : metric === "politics" ? t("politicsReference", { year })
              : metric === "costs"
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
            politicsMetric: t("metricPolitics"),
            digitalMetric: t("metricDigital"),
            digitalView: t("digitalView"),
            digitalViews: digitalViewLabels,
            digitalProviderLabels,
            digitalDefinition: t(digitalView === "providers" ? "digitalProviderDefinition" : "digitalDefinition"),
            digitalNoneFound: t("digitalNoneFound"),
            digitalLegendOne: t("digitalLegendOne"),
            digitalLegendTwo: t("digitalLegendTwo"),
            digitalLegendThreeToFour: t("digitalLegendThreeToFour"),
            digitalLegendFiveToSeven: t("digitalLegendFiveToSeven"),
            digitalLegendEightPlus: t("digitalLegendEightPlus"),
            politicsView: t("politicsView"),
            politicsViews: politicsViewLabels,
            politicsParty: t("politicsParty"),
            politicsParties: politicsPartyLabels,
            politicsTie: t("politicsTie"),
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
            restoreChart: t("restoreMetricChart"),
            loadingAge: t("ageLayerLoading"),
            ageError: t("ageLayerError"),
            loadingMovement: t("movementLayerLoading"),
            movementError: t("movementLayerError"),
            loadingCosts: t("costLayerLoading"),
            costsError: t("costLayerError"),
            loadingPolitics: t("politicsLayerLoading"),
            politicsError: t("politicsLayerError"),
            loadingDigital: t("digitalLayerLoading"),
            digitalError: t("digitalLayerError"),
            loadingStructure: t("structureLayerLoading"),
            structureError: t("structureLayerError"),
            addToAnalysis: t("addToAnalysis"),
            dragToAnalysis: t("dragToAnalysis"),
            noData: t("mapNoData"),
            zoomHintWindows: t("mapZoomHintWindows"),
            zoomHintMac: t("mapZoomHintMac"),
            zoomHintMobile: t("mapZoomHintMobile"),
            display: t("mobileDisplay"),
            legend: t("mobileLegend"),
            details: t("mobileDetails"),
            close: t("mobileClose"),
            selected: t("mobileSelected"),
          }}
          selectedMetricHistory={history}
          metricChartLabel={metricChartLabel}
          metricLabel={metricLabel}
          chartValueFormatter={chartFormatter}
          chartUnitLabel={chartUnit}
          chartChangeLabels={metric === "population" && populationView === "count" ? { previousYear: t("populationChangePreviousYear"), sinceFirstYear: t("populationChangeSinceFirstYear", { year: populationSeries.firstYear }) } : undefined}
          analysisDataset={analysisDataset}
        />
      </section>
      <aside
        className="hidden flex-col gap-4 lg:flex"
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
                <dt className="text-muted-foreground">{t("municipalityCode")}</dt><dd className="font-mono font-medium">{selected.municipalityCode}</dd>
                <dt className="text-muted-foreground">{t("state")}</dt><dd className="font-medium">{selected.state}</dd>
                <dt className="text-muted-foreground">{t("district")}</dt><dd className="font-medium">{selectedProfile?.district ?? t("profileDataUnavailable")}</dd>
                <dt className="text-muted-foreground">{t("population")}</dt><dd className="font-semibold tabular-nums">{personsFormatter.format(selectedPopulation)}</dd>
                {metric === "population" && populationView === "density" ? <><dt className="text-muted-foreground">{t("municipalityArea")}</dt><dd className="font-medium tabular-nums">{ratioFormatter.format(selected.areaSquareKilometers)} {t("areaUnit")}</dd></> : null}
                {metric === "digital" && digitalView === "providers" ? <><dt className="text-muted-foreground">{metricLabel}</dt><dd className="font-semibold">{digitalProviderDescription(selectedDigitalPlatforms ?? undefined)}</dd></> : null}
                {metric === "digital" && digitalView === "providers" ? <>
                  <dt className="text-muted-foreground">{t("digitalCostAnnualLabel")}</dt><dd className="font-semibold tabular-nums" data-testid="digital-cost-annual">{selectedDigitalCostEstimate ? formatDigitalCostRange(selectedDigitalCostEstimate.annualEuros) : t("digitalCostUnavailable")}</dd>
                  <dt className="text-muted-foreground">{t("digitalCostSetupLabel")}</dt><dd className="font-medium tabular-nums">{selectedDigitalCostEstimate ? formatDigitalCostRange(selectedDigitalCostEstimate.setupEuros) : t("digitalCostUnavailable")}</dd>
                  {selectedDigitalCostEstimate ? <><dt className="text-muted-foreground">{t("digitalCostConfidenceLabel")}</dt><dd className="font-medium">{t(selectedDigitalCostEstimate.confidence === "medium" ? "digitalCostConfidenceMedium" : "digitalCostConfidenceLow")}</dd></> : null}
                </> : null}
                {activeValue !== null && metric !== "politics" && !(metric === "digital" && digitalView === "providers") && !(metric === "population" && populationView === "count") ? <><dt className="text-muted-foreground">{metricLabel}</dt><dd className="font-semibold tabular-nums">{chartFormatter.format(activeValue)}{chartUnit ? ` ${chartUnit}` : ""}</dd></> : null}
                {previousValue !== null ? <><dt className="text-muted-foreground">{metric === "population" ? t("populationChangePreviousYear") : metric === "movement" ? t("movementChangePreviousYear") : metric === "age" ? t("ageChangePreviousYear") : t("costChangePreviousYear")}</dt><dd className="font-medium tabular-nums">{formatMetricChange(activeValue, previousValue)}</dd></> : null}
                {averageAnnualPopulationChange !== null ? <><dt className="text-muted-foreground">{t("populationAverageAnnualChange", { year: populationSeries.firstYear })}</dt><dd className="font-medium tabular-nums">{signedShareFormatter.format(averageAnnualPopulationChange)}</dd></> : null}
                <dt className="text-muted-foreground">{t("officialWebsite")}</dt><dd className="min-w-0 font-medium">{selectedProfile?.officialWebsite ? <a className="break-all text-teal-700 underline underline-offset-2 hover:text-teal-800" href={selectedProfile.officialWebsite} target="_blank" rel="noreferrer">{t("openWebsite")}</a> : t("profileDataUnavailable")}</dd>
              </dl>
              {metric === "digital" && digitalView === "providers" ? renderDigitalCostMethodology() : null}
              {metric === "digital" && selectedDigitalPlatforms && digitalPlatforms ? (
                <div className="mt-5">
                  <MunicipalityDigitalPlatformsPanel profile={selectedDigitalPlatforms} referenceDate={digitalPlatforms.referenceDate} />
                </div>
              ) : null}
              <div className="mt-5">
                <MunicipalityPoliticsPanel
                  current={selectedCurrentPolitics}
                  currentSources={currentPolitics?.sources ?? []}
                  history={selectedElectionHistory}
                  historySources={electionHistory?.sources ?? []}
                  loadingHistory={politicsHistoryRequested && !electionHistory && !politicsError}
                  historyError={politicsError}
                  onOpenHistory={() => setPoliticsHistoryRequested(true)}
                />
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" />
                {metric === "digital"
                  ? t("digitalReference", { date: digitalReferenceDate })
                  : metric === "politics"
                  ? t("politicsReference", { year })
                  : metric === "costs"
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
          {digitalPlatforms && (
            <p className="mt-2">{t("digitalDataBasis", { date: digitalReferenceDate })}</p>
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

      <MobileBottomSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={selected ? selected.name : t("selectionTitle")}
        description={selected ? t("selectedMunicipality") : t("selectionDescription")}
        closeLabel={t("mobileClose")}
      >
        <div className="space-y-4" aria-live="polite" data-testid="mobile-municipality-details">
          {selected ? (
            <>
              <div className="rounded-xl border bg-card p-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 text-sm">
                  <dt className="text-muted-foreground">{t("municipalityCode")}</dt><dd className="font-mono font-medium">{selected.municipalityCode}</dd>
                  <dt className="text-muted-foreground">{t("state")}</dt><dd className="font-medium">{selected.state}</dd>
                  <dt className="text-muted-foreground">{t("district")}</dt><dd className="font-medium">{selectedProfile?.district ?? t("profileDataUnavailable")}</dd>
                  <dt className="text-muted-foreground">{t("population")}</dt><dd className="font-semibold tabular-nums">{personsFormatter.format(selectedPopulation)}</dd>
                  {metric === "population" && populationView === "density" ? <><dt className="text-muted-foreground">{t("municipalityArea")}</dt><dd className="font-medium tabular-nums">{ratioFormatter.format(selected.areaSquareKilometers)} {t("areaUnit")}</dd></> : null}
                  {metric === "digital" && digitalView === "providers" ? <><dt className="text-muted-foreground">{metricLabel}</dt><dd className="font-semibold">{digitalProviderDescription(selectedDigitalPlatforms ?? undefined)}</dd></> : null}
                {metric === "digital" && digitalView === "providers" ? <>
                  <dt className="text-muted-foreground">{t("digitalCostAnnualLabel")}</dt><dd className="font-semibold tabular-nums" data-testid="digital-cost-annual">{selectedDigitalCostEstimate ? formatDigitalCostRange(selectedDigitalCostEstimate.annualEuros) : t("digitalCostUnavailable")}</dd>
                  <dt className="text-muted-foreground">{t("digitalCostSetupLabel")}</dt><dd className="font-medium tabular-nums">{selectedDigitalCostEstimate ? formatDigitalCostRange(selectedDigitalCostEstimate.setupEuros) : t("digitalCostUnavailable")}</dd>
                  {selectedDigitalCostEstimate ? <><dt className="text-muted-foreground">{t("digitalCostConfidenceLabel")}</dt><dd className="font-medium">{t(selectedDigitalCostEstimate.confidence === "medium" ? "digitalCostConfidenceMedium" : "digitalCostConfidenceLow")}</dd></> : null}
                </> : null}
                  {activeValue !== null && metric !== "politics" && !(metric === "digital" && digitalView === "providers") && !(metric === "population" && populationView === "count") ? <><dt className="text-muted-foreground">{metricLabel}</dt><dd className="font-semibold tabular-nums">{chartFormatter.format(activeValue)}{chartUnit ? ` ${chartUnit}` : ""}</dd></> : null}
                  {previousValue !== null ? <><dt className="text-muted-foreground">{metric === "population" ? t("populationChangePreviousYear") : metric === "movement" ? t("movementChangePreviousYear") : metric === "age" ? t("ageChangePreviousYear") : t("costChangePreviousYear")}</dt><dd className="font-medium tabular-nums">{formatMetricChange(activeValue, previousValue)}</dd></> : null}
                  {averageAnnualPopulationChange !== null ? <><dt className="text-muted-foreground">{t("populationAverageAnnualChange", { year: populationSeries.firstYear })}</dt><dd className="font-medium tabular-nums">{signedShareFormatter.format(averageAnnualPopulationChange)}</dd></> : null}
                  <dt className="text-muted-foreground">{t("officialWebsite")}</dt>
                  <dd className="min-w-0 font-medium">
                    {selectedProfile?.officialWebsite ? (
                      <a className="break-all text-teal-700 underline underline-offset-2" href={selectedProfile.officialWebsite} target="_blank" rel="noreferrer">{t("openWebsite")}</a>
                    ) : t("profileDataUnavailable")}
                  </dd>
                </dl>
                {metric === "digital" && digitalView === "providers" ? renderDigitalCostMethodology() : null}
                {metric === "digital" && selectedDigitalPlatforms && digitalPlatforms ? (
                  <div className="mt-5">
                    <MunicipalityDigitalPlatformsPanel profile={selectedDigitalPlatforms} referenceDate={digitalPlatforms.referenceDate} />
                  </div>
                ) : null}
                <div className="mt-5">
                  <MunicipalityPoliticsPanel
                    current={selectedCurrentPolitics}
                    currentSources={currentPolitics?.sources ?? []}
                    history={selectedElectionHistory}
                    historySources={electionHistory?.sources ?? []}
                    loadingHistory={politicsHistoryRequested && !electionHistory && !politicsError}
                    historyError={politicsError}
                    onOpenHistory={() => setPoliticsHistoryRequested(true)}
                  />
                </div>
                <p className="mt-4 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                  <Users className="size-3.5" />
                  {metric === "digital"
                    ? t("digitalReference", { date: digitalReferenceDate })
                    : metric === "politics"
                    ? t("politicsReference", { year })
                    : metric === "costs"
                    ? t("costReference", { year })
                    : metric === "movement"
                      ? t("movementReference", { year })
                      : usesCitizenship
                        ? t("structureReference", { year })
                        : t("populationReference", { year })}
                </p>
              </div>

              {history && analysisDataset ? (
                <MunicipalityMetricChart
                  embedded
                  metricLabel={metricLabel}
                  municipalityName={selected.name}
                  points={history}
                  selectedYear={year}
                  valueFormatter={chartFormatter}
                  unitLabel={chartUnit}
                  changeLabels={metric === "population" && populationView === "count" ? { previousYear: t("populationChangePreviousYear"), sinceFirstYear: t("populationChangeSinceFirstYear", { year: populationSeries.firstYear }) } : undefined}
                  chartLabel={metricChartLabel}
                  minimizeLabel={t("minimizeMetricChart")}
                  expandLabel={t("expandMetricChart")}
                  restoreLabel={t("restoreMetricChart")}
                  dataset={analysisDataset}
                  addToAnalysisLabel={t("addToAnalysis")}
                  dragToAnalysisLabel={t("dragToAnalysis")}
                />
              ) : null}

              {investmentMunicipalityCodes?.has(selected.municipalityCode) ? (
                <Button className="h-11 w-full" variant="outline" render={<Link href={`/municipalities/${selected.municipalityCode}/investments`} />}>
                  <Landmark className="size-4" />
                  {t("investmentDetails")}
                </Button>
              ) : null}
              <Button
                className="h-11 w-full"
                variant="outline"
                onClick={() => {
                  updateSelection(null);
                  setDetailsOpen(false);
                }}
              >
                <X className="size-4" />
                {t("clearSelection")}
              </Button>
            </>
          ) : (
            <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
              {t("selectionDescription")}
            </div>
          )}
          <div className="rounded-xl border bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <Database className="size-4" />
              {t("dataBasis")}
            </div>
            <p>{t("dataBasisDescription", { count: index.count })}</p>
            <p className="mt-2">
              {t("populationDataBasis", { firstYear: populationSeries.firstYear, latestYear: populationSeries.latestYear })}{" "}
              <a className="underline underline-offset-2" href={populationSeries.source.urlTemplate.replace("{year}", String(populationSeries.latestYear))} target="_blank" rel="noreferrer">{populationSeries.source.title}</a>
              {` (${populationSeries.source.license}).`}
            </p>
          </div>
        </div>
      </MobileBottomSheet>
    </div>
  );
}
