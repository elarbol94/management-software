"use client";

import { useMemo, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

type MetricPoint = {
  year: number;
  value: number;
};

const CHART_WIDTH = 320;
const CHART_HEIGHT = 172;
const PLOT_LEFT = 62;
const PLOT_RIGHT = 14;
const PLOT_TOP = 14;
const PLOT_BOTTOM = 30;

function chartDomain(values: number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const difference = maximum - minimum;
  const padding = difference === 0
    ? Math.max(Math.abs(maximum) * 0.04, 1)
    : Math.max(difference * 0.12, 1);
  return { minimum: minimum - padding, maximum: maximum + padding };
}

export function MunicipalityMetricChart({
  metricLabel,
  municipalityName,
  points,
  selectedYear,
  valueFormatter,
  chartLabel,
  minimizeLabel,
  expandLabel,
}: {
  metricLabel: string;
  municipalityName: string;
  points: MetricPoint[];
  selectedYear: number;
  valueFormatter: Intl.NumberFormat;
  chartLabel: string;
  minimizeLabel: string;
  expandLabel: string;
}) {
  const [minimized, setMinimized] = useState(false);
  const chart = useMemo(() => {
    const domain = chartDomain(points.map(({ value }) => value));
    const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
    const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
    const x = (year: number) => PLOT_LEFT + ((year - points[0].year) / (points.at(-1)!.year - points[0].year || 1)) * plotWidth;
    const y = (value: number) => PLOT_TOP + ((domain.maximum - value) / (domain.maximum - domain.minimum)) * plotHeight;
    const selected = points.find((point) => point.year === selectedYear) ?? points.at(-1)!;
    return {
      domain,
      selected: { ...selected, x: x(selected.year), y: y(selected.value) },
      path: points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.year)} ${y(point.value)}`).join(" "),
      points: points.map((point) => ({ ...point, x: x(point.year), y: y(point.value) })),
      x,
      y,
    };
  }, [points, selectedYear]);

  const ticks = [chart.domain.maximum, (chart.domain.minimum + chart.domain.maximum) / 2, chart.domain.minimum];

  return (
    <section
      className={`absolute right-3 bottom-3 z-10 overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur ${minimized ? "w-auto" : "w-[min(20rem,calc(100%-13rem))] min-w-44 sm:w-80"}`}
      data-testid="municipality-metric-chart"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold">{metricLabel}</h3>
          {!minimized && <p className="truncate text-[10px] text-muted-foreground">{municipalityName}</p>}
        </div>
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-accent"
          aria-label={minimized ? expandLabel : minimizeLabel}
          aria-expanded={!minimized}
          onClick={() => setMinimized((value) => !value)}
        >
          {minimized ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
        </button>
      </div>
      {!minimized && (
        <div className="border-t px-2 pt-1 pb-2">
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-40 w-full" role="img" aria-label={chartLabel}>
            <rect x={PLOT_LEFT} y={PLOT_TOP} width={CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT} height={CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM} fill="none" stroke="currentColor" strokeOpacity="0.18" />
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PLOT_LEFT} x2={CHART_WIDTH - PLOT_RIGHT} y1={chart.y(tick)} y2={chart.y(tick)} stroke="currentColor" strokeOpacity="0.16" strokeDasharray="3 4" />
                <text x={PLOT_LEFT - 6} y={chart.y(tick) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px]">{valueFormatter.format(Math.round(tick))}</text>
              </g>
            ))}
            <path d={chart.path} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-700 dark:text-teal-300" />
            {chart.points.map((point) => (
              <circle key={point.year} cx={point.x} cy={point.y} r={point.year === chart.selected.year ? 3.8 : 1.9} className={point.year === chart.selected.year ? "fill-background stroke-teal-700 dark:stroke-teal-300" : "fill-teal-700 dark:fill-teal-300"} strokeWidth="2" />
            ))}
            <line x1={chart.selected.x} x2={chart.selected.x} y1={PLOT_TOP} y2={CHART_HEIGHT - PLOT_BOTTOM} className="stroke-teal-700/45 dark:stroke-teal-300/45" strokeDasharray="3 3" />
            <text x={PLOT_LEFT} y={CHART_HEIGHT - 9} className="fill-muted-foreground text-[10px]">{points[0].year}</text>
            <text x={CHART_WIDTH - PLOT_RIGHT} y={CHART_HEIGHT - 9} textAnchor="end" className="fill-muted-foreground text-[10px]">{points.at(-1)!.year}</text>
            <text x={chart.selected.x} y={PLOT_TOP + 10} textAnchor="middle" className="fill-foreground text-[10px] font-semibold">{chart.selected.year}</text>
          </svg>
          <p className="px-1 text-[10px] text-muted-foreground">{chart.selected.year}: <span className="font-semibold text-foreground tabular-nums">{valueFormatter.format(chart.selected.value)}</span></p>
        </div>
      )}
    </section>
  );
}
