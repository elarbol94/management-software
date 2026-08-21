"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
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
  municipalityPopulationYears,
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
const formatSigned = (value: number, formatter: Intl.NumberFormat) =>
  `${value > 0 ? "+" : ""}${formatter.format(value)}`;

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
  const [loadError, setLoadError] = useState(false);
  const [demographyError, setDemographyError] = useState(false);
  const [movementError, setMovementError] = useState(false);
  const [structureError, setStructureError] = useState(false);
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
    metricParameter === "age" || metricParameter === "movement"
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
  const selectedCode = searchParams.get("municipality") ?? "";
  const selected = useMemo(
    () =>
      index?.municipalities.find(
        (item) => item.municipalityCode === selectedCode,
      ) ?? null,
    [index, selectedCode],
  );
  const usesCitizenship = populationView === "foreign-share" || populationView === "foreign-persons";
  const availableFirstYear = usesCitizenship ? MUNICIPALITY_STRUCTURE_FIRST_YEAR : populationSeries?.firstYear;
  const availableLatestYear = usesCitizenship ? MUNICIPALITY_STRUCTURE_LATEST_YEAR : populationSeries?.latestYear;
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
        : Object.fromEntries(
            index.municipalities.map(({ municipalityCode }) => [
              municipalityCode,
              activeMovement ? movementValueFor(municipalityCode, year) : null,
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
          : movementValueFor(selected.municipalityCode, targetYear)
      : null;
  const previousValue =
    previousYear === null ? null : metricValueForYear(previousYear);
  const firstValue = metricValueForYear(availableFirstYear!);
  const historyAvailable =
    (metric === "population" && (!usesCitizenship || structureSeries)) ||
    (metric === "age" && demographySeries) ||
    (metric === "movement" && movementSeries);
  const history =
    selected && historyAvailable
      ? municipalityPopulationYears().filter((historyYear) => historyYear >= availableFirstYear! && historyYear <= availableLatestYear!).map((historyYear) => ({
          year: historyYear,
          value: metricValueForYear(historyYear) ?? 0,
        }))
      : null;
  const chartFormatter =
    metric === "movement"
      ? movementFormatter
      : metric === "population"
        ? populationViewFormatter
        : !indicator && ageMeasure === "persons"
          ? personsFormatter
        : indicator && (indicatorUnit === "per-100" || indicatorUnit === "years")
          ? ratioFormatter
          : shareFormatter;
  const chartUnit =
    metric === "movement"
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
    metric === "population"
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
  const scaleDomain =
    metric === "population"
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
                className="absolute top-[calc(100%+0.4rem)] max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl"
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
          structureLoading={usesCitizenship && !structureSeries && !structureError}
          structureError={structureError}
          onYearChange={(value) =>
            setParameter("populationYear", String(value))
          }
          onMetricChange={(value) =>
            setParameter("metric", value === "population" ? null : value)
          }
          onPopulationViewChange={updatePopulationView}
          onAgeViewChange={updateAgeView}
          onAgeMeasureChange={(value) => setParameter("ageMeasure", value)}
          onSexChange={(value) => setParameter("sex", value)}
          onMovementViewChange={(value) =>
            setParameter("movementMetric", value)
          }
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
              metric === "movement"
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
            loadingStructure: t("structureLayerLoading"),
            structureError: t("structureLayerError"),
          }}
          selectedMetricHistory={history}
          metricChartLabel={
            selected
              ? metric === "population"
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
                <dt className="text-muted-foreground">{t("population")}</dt>
                <dd className="font-semibold tabular-nums">
                  {personsFormatter.format(selectedPopulation)}
                </dd>
                {metric === "population" ? (
                  <>
                    {populationView !== "count" && (
                      <>
                        <dt className="text-muted-foreground">{populationViewLabels[populationView]}</dt>
                        <dd className="font-semibold tabular-nums">
                          {activeValue === null ? "—" : populationViewFormatter.format(activeValue) + (populationUnitLabel ? " " + populationUnitLabel : "")}
                        </dd>
                      </>
                    )}
                    {populationView === "density" && (
                      <>
                        <dt className="text-muted-foreground">{t("municipalityArea")}</dt>
                        <dd className="font-medium tabular-nums">{ratioFormatter.format(selected.areaSquareKilometers)} {t("areaUnit")}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">{t("populationChangePreviousYear")}</dt>
                    <dd className="font-medium tabular-nums">{formatMetricChange(activeValue, previousValue)}</dd>
                    <dt className="text-muted-foreground">
                      {t("populationChangeSinceFirstYear", { year: availableFirstYear! })}
                    </dt>
                    <dd className="font-medium tabular-nums">{formatMetricChange(activeValue, firstValue)}</dd>
                    {populationView === "count" && (
                      <>
                        <dt className="text-muted-foreground">
                          {t("populationAverageAnnualChange", { year: populationSeries.firstYear })}
                        </dt>
                        <dd className="font-medium tabular-nums">
                          {averageAnnualPopulationChange === null ? "—" : signedShareFormatter.format(averageAnnualPopulationChange)}
                        </dd>
                      </>
                    )}
                  </>
                ) : metric === "movement" ? (
                  <>
                    <dt className="text-muted-foreground">
                      {movementLabels[movementView]}
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {activeValue === null
                        ? "—"
                        : movementFormatter.format(activeValue) +
                          " " +
                          movementUnitLabel}
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("movementChangePreviousYear")}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {formatMetricChange(activeValue, previousValue)}
                    </dd>
                    {movementView === "population-change" && (
                      <>
                        <dt className="text-muted-foreground">
                          {t("movementStatisticalCorrection")}
                        </dt>
                        <dd className="font-medium tabular-nums">
                          {statisticalCorrection === null
                            ? "—"
                            : formatSigned(
                                statisticalCorrection,
                                personsFormatter,
                              )}
                        </dd>
                      </>
                    )}
                  </>
                ) : indicator ? (
                  <>
                    <dt className="text-muted-foreground">
                      {indicatorLabels[indicator]}
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {activeValue === null
                        ? "—"
                        : indicatorFormatter.format(activeValue) + (indicatorUnitLabel ? " " + indicatorUnitLabel : "")}
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("ageChangePreviousYear")}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {formatMetricChange(activeValue, previousValue)}
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("ageChangeSinceFirstYear", {
                        year: populationSeries.firstYear,
                      })}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {formatMetricChange(activeValue, firstValue)}
                    </dd>
                  </>
                ) : (
                  <>
                    <dt className="text-muted-foreground">
                      {ageGroupLabels[ageGroup]}
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {selectedAgePersons === null
                        ? "—"
                        : `${personsFormatter.format(selectedAgePersons)} ${t("populationUnit")}`}
                    </dd>
                    <dt className="text-muted-foreground">
                      {sex === "female"
                        ? t("ageShareWithinFemale")
                        : sex === "male"
                          ? t("ageShareWithinMale")
                          : t("ageShare")}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {selectedAgeShare === null
                        ? "—"
                        : shareFormatter.format(selectedAgeShare)}
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("ageChangePreviousYear")}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {formatMetricChange(activeValue, previousValue)}
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("ageChangeSinceFirstYear", {
                        year: populationSeries.firstYear,
                      })}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {formatMetricChange(activeValue, firstValue)}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">{t("state")}</dt>
                <dd className="font-medium">{selected.state}</dd>
                <dt className="text-muted-foreground">
                  {t("municipalityCode")}
                </dt>
                <dd className="font-mono font-medium">
                  {selected.municipalityCode}
                </dd>
              </dl>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5" />
                {metric === "movement"
                  ? t("movementReference", { year })
                  : usesCitizenship
                    ? t("structureReference", { year })
                    : t("populationReference", { year })}
              </p>
              <Button
                variant="outline"
                className="mt-5 w-full"
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
          <p className="mt-2">{t("geometryAttribution")}</p>
        </div>
      </aside>
    </div>
  );
}
