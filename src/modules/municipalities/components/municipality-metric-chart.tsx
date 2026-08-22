"use client";

import { useMemo, useState } from "react";
import { BarChart3, GripVertical, Maximize2, Minimize2 } from "lucide-react";
import type { MunicipalityDatasetRef } from "../analysis";
import { requestMunicipalityDatasetTransfer, writeMunicipalityDatasetDrag } from "../transfer";

type MetricPoint = {
  year: number;
  value: number | null;
};

const CHART_WIDTH = 320;
const CHART_HEIGHT = 172;
const PLOT_LEFT = 62;
const PLOT_RIGHT = 14;
const PLOT_TOP = 14;
const PLOT_BOTTOM = 30;

export function chartDomain(values: number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const difference = maximum - minimum;
  const padding = difference === 0
    ? Math.max(Math.abs(maximum) * 0.04, 1e-6)
    : difference * 0.12;
  return { minimum: minimum - padding, maximum: maximum + padding };
}

export function domainCrossesZero(domain: { minimum: number; maximum: number }) {
  return domain.minimum < 0 && domain.maximum > 0;
}

export function MunicipalityMetricChart({
  metricLabel,
  municipalityName,
  points,
  selectedYear,
  valueFormatter,
  unitLabel,
  chartLabel,
  minimizeLabel,
  expandLabel,
  dataset,
  addToAnalysisLabel,
  dragToAnalysisLabel,
  changeLabels,
}: {
  metricLabel: string;
  municipalityName: string;
  points: MetricPoint[];
  selectedYear: number;
  valueFormatter: Intl.NumberFormat;
  unitLabel: string;
  chartLabel: string;
  minimizeLabel: string;
  expandLabel: string;
  dataset: MunicipalityDatasetRef;
  addToAnalysisLabel: string;
  dragToAnalysisLabel: string;
  changeLabels?: { previousYear: string; sinceFirstYear: string };
}) {
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const chart = useMemo(() => {
    const valid = points.filter((point): point is { year: number; value: number } => point.value !== null);
    if (!valid.length) return null;
    const domain = chartDomain(valid.map(({ value }) => value));
    const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
    const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
    const x = (year: number) => PLOT_LEFT + ((year - points[0].year) / (points.at(-1)!.year - points[0].year || 1)) * plotWidth;
    const y = (value: number) => PLOT_TOP + ((domain.maximum - value) / (domain.maximum - domain.minimum)) * plotHeight;
    const selected = valid.find((point) => point.year === selectedYear) ?? valid.at(-1)!;
    const plotted = points.map((point) => point.value === null ? null : ({ ...point, x: x(point.year), y: y(point.value) }));
    const paths: string[] = [];
    let segment: string[] = [];
    for (const point of plotted) {
      if (!point) {
        if (segment.length) paths.push(segment.join(" "));
        segment = [];
      } else segment.push(`${segment.length ? "L" : "M"} ${point.x} ${point.y}`);
    }
    if (segment.length) paths.push(segment.join(" "));
    return {
      domain,
      selected: { ...selected, x: x(selected.year), y: y(selected.value) },
      paths,
      points: plotted.filter((point): point is { year: number; value: number; x: number; y: number } => point !== null),
      x,
      y,
    };
  }, [points, selectedYear]);

  const ticks = chart ? [chart.domain.maximum, (chart.domain.minimum + chart.domain.maximum) / 2, chart.domain.minimum] : [];
  const active = chart ? (chart.points.find((point) => point.year === hoveredYear) ?? chart.selected) : null;
  const zeroLineVisible = chart ? domainCrossesZero(chart.domain) : false;
  const previousPoint = active && chart ? (chart.points.filter((point) => point.year < active.year).at(-1) ?? null) : null;
  const firstPoint = chart?.points[0] ?? null;
  const formatDelta = (value: number) => (value > 0 ? "+" : "") + valueFormatter.format(value) + " " + unitLabel;

  return (
    <section
      className={`absolute right-3 bottom-3 z-10 overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur ${expanded ? "fixed inset-4 z-50 w-auto max-w-none" : minimized ? "w-auto" : "w-[min(20rem,calc(100%-13rem))] min-w-44 sm:w-80"}`}
      data-testid="municipality-metric-chart"
    >
      <div
        className="flex cursor-grab items-center justify-between gap-2 px-3 py-2 active:cursor-grabbing"
        draggable
        title={dragToAnalysisLabel}
        onDragStart={(event) => writeMunicipalityDatasetDrag(event, dataset)}
      >
        <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold">{metricLabel}</h3>
          {!minimized && <p className="truncate text-[10px] text-muted-foreground">{municipalityName}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="grid size-7 place-items-center rounded-md hover:bg-accent"
            aria-label={addToAnalysisLabel}
            title={addToAnalysisLabel}
            onClick={() => requestMunicipalityDatasetTransfer(dataset)}
          ><BarChart3 className="size-3.5" /></button>
          <button type="button" className="grid size-7 place-items-center rounded-md hover:bg-accent" aria-label={expanded ? minimizeLabel : expandLabel} title={expanded ? minimizeLabel : expandLabel} onClick={() => setExpanded((value) => !value)}>{expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>
          <button
            type="button"
            className="grid size-7 place-items-center rounded-md hover:bg-accent"
            aria-label={minimized ? expandLabel : minimizeLabel}
            aria-expanded={!minimized}
            onClick={() => setMinimized((value) => !value)}
          >
            {minimized ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
          </button>
        </div>
      </div>
      {!minimized && (
        <div className="relative border-t px-2 pt-1 pb-2">
          {!chart || !active ? <div className="grid h-40 place-items-center text-sm text-muted-foreground">—</div> : <>
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className={expanded ? "h-[calc(100dvh-12rem)] max-h-[42rem] w-full" : "h-40 w-full"} role="img" aria-label={chartLabel}>
            <rect x={PLOT_LEFT} y={PLOT_TOP} width={CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT} height={CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM} fill="none" stroke="currentColor" strokeOpacity="0.18" />
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PLOT_LEFT} x2={CHART_WIDTH - PLOT_RIGHT} y1={chart.y(tick)} y2={chart.y(tick)} stroke="currentColor" strokeOpacity="0.16" strokeDasharray="3 4" />
                <text x={PLOT_LEFT - 6} y={chart.y(tick) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px]">{valueFormatter.format(tick)}</text>
              </g>
            ))}
            {zeroLineVisible && <line data-testid="municipality-metric-chart-zero-line" x1={PLOT_LEFT} x2={CHART_WIDTH - PLOT_RIGHT} y1={chart.y(0)} y2={chart.y(0)} stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" />}
            {chart.paths.map((path) => <path key={path} d={path} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-700 dark:text-teal-300" />)}
            {chart.points.map((point) => (
              <g key={point.year}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={point.year === active.year ? 3.8 : 1.9}
                  className={point.year === active.year ? "fill-background stroke-teal-700 dark:stroke-teal-300" : "fill-teal-700 dark:fill-teal-300"}
                  strokeWidth="2"
                />
                <circle
                  data-testid={"municipality-metric-chart-point-" + point.year}
                  cx={point.x}
                  cy={point.y}
                  r="10"
                  fill="currentColor"
                  fillOpacity="0"
                  onPointerEnter={() => setHoveredYear(point.year)}
                  onPointerLeave={() => setHoveredYear(null)}
                />
              </g>
            ))}
            <line x1={active.x} x2={active.x} y1={PLOT_TOP} y2={CHART_HEIGHT - PLOT_BOTTOM} className="pointer-events-none stroke-teal-700/45 dark:stroke-teal-300/45" strokeDasharray="3 3" />
            <text x={PLOT_LEFT} y={CHART_HEIGHT - 9} className="fill-muted-foreground text-[10px]">{points[0].year}</text>
            <text x={CHART_WIDTH - PLOT_RIGHT} y={CHART_HEIGHT - 9} textAnchor="end" className="fill-muted-foreground text-[10px]">{points.at(-1)!.year}</text>
            <text x={active.x} y={PLOT_TOP + 10} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">{active.year}</text>
          </svg>
          {hoveredYear !== null && <div className="pointer-events-none absolute z-10 w-max max-w-[13rem] rounded-md border bg-popover px-2 py-1.5 text-[10px] shadow-md" style={{ left: (Math.min(86, Math.max(14, active.x / CHART_WIDTH * 100))) + "%", top: (Math.max(6, active.y / CHART_HEIGHT * 100)) + "%", transform: "translate(-50%, -115%)" }} data-testid="municipality-metric-chart-hover-card"><p className="font-semibold">{active.year}</p><p className="tabular-nums">{valueFormatter.format(active.value)} {unitLabel}</p>{changeLabels && previousPoint && <p className="mt-1 text-muted-foreground">{changeLabels.previousYear}: {formatDelta(active.value - previousPoint.value)}</p>}{changeLabels && firstPoint && firstPoint.year !== active.year && <p className="text-muted-foreground">{changeLabels.sinceFirstYear}: {formatDelta(active.value - firstPoint.value)}</p>}</div>}
          <p className="px-1 text-[10px] text-muted-foreground" role="tooltip" data-testid="municipality-metric-chart-tooltip">{active.year}: <span className="font-semibold text-foreground tabular-nums">{valueFormatter.format(active.value)}</span> {unitLabel}</p>
          </>}
        </div>
      )}
    </section>
  );
}
