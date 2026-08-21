"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import type { AnalysisSeries } from "../analysis";

export function AnalysisSeriesChart({ series, label, compact = false, trueLabel, falseLabel }: { series: AnalysisSeries; label: string; compact?: boolean; trueLabel: string; falseLabel: string }) {
  const locale = useLocale();
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const chart = useMemo(() => {
    const valid = series.points.filter((point): point is { year: number; value: number | boolean } => point.value !== null);
    if (!valid.length) return null;
    const numeric = series.points.map((point) => ({ year: point.year, value: point.value === null ? null : typeof point.value === "boolean" ? Number(point.value) : point.value }));
    const validNumeric = numeric.filter((point): point is { year: number; value: number } => point.value !== null);
    const minYear = Math.min(...numeric.map(({ year }) => year));
    const maxYear = Math.max(...numeric.map(({ year }) => year));
    let minimum = Math.min(...validNumeric.map(({ value }) => value));
    let maximum = Math.max(...validNumeric.map(({ value }) => value));
    if (minimum === maximum) { minimum -= 1; maximum += 1; }
    const x = (year: number) => 8 + ((year - minYear) / (maxYear - minYear || 1)) * 304;
    const y = (value: number) => 8 + ((maximum - value) / (maximum - minimum)) * (compact ? 48 : 142);
    const points = validNumeric.map((point) => ({ ...point, x: x(point.year), y: y(point.value) }));
    const paths: string[] = [];
    let segment: string[] = [];
    for (const point of numeric) {
      if (point.value === null) {
        if (segment.length) paths.push(segment.join(" "));
        segment = [];
      } else segment.push(`${segment.length ? "L" : "M"} ${x(point.year)} ${y(point.value)}`);
    }
    if (segment.length) paths.push(segment.join(" "));
    return { minYear, maxYear, points, paths };
  }, [compact, series]);
  if (!chart) return <div className={compact ? "h-14" : "grid h-44 place-items-center text-sm text-muted-foreground"}>—</div>;
  const active = chart.points.find(({ year }) => year === hoveredYear) ?? chart.points.at(-1)!;
  const activePoint = series.points.find(({ year }) => year === active.year)!;
  const displayValue = typeof activePoint.value === "boolean"
    ? (activePoint.value ? trueLabel : falseLabel)
    : new Intl.NumberFormat(locale, series.unit === "share"
      ? { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2 }
      : { maximumFractionDigits: 2 }).format(activePoint.value ?? 0);
  return (
    <div>
      <svg viewBox={`0 0 320 ${compact ? 64 : 170}`} className={compact ? "h-14 w-full" : "h-44 w-full"} role="img" aria-label={label}>
        {chart.paths.map((path) => <path key={path} d={path} fill="none" stroke="currentColor" strokeWidth={compact ? 3 : 2.5} strokeLinecap="round" strokeLinejoin="round" className="text-teal-700 dark:text-teal-300" />)}
        {chart.points.map((point) => (
          <circle key={point.year} cx={point.x} cy={point.y} r={compact ? 5 : 8} fill="transparent" onPointerEnter={() => setHoveredYear(point.year)} onPointerLeave={() => setHoveredYear(null)} />
        ))}
        {!compact && <line x1={active.x} x2={active.x} y1="6" y2="154" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="3 3" />}
      </svg>
      {!compact && <p className="text-xs text-muted-foreground" role="status">{active.year}: <span className="font-semibold text-foreground">{displayValue}</span>{series.unit && series.unit !== "boolean" && series.unit !== "share" ? ` · ${series.unit}` : ""}</p>}
    </div>
  );
}
