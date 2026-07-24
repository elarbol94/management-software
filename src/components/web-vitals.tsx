"use client";

import { useReportWebVitals } from "next/web-vitals";
import {
  enqueuePerformanceEvent,
  normalizeClientRoute,
} from "@/lib/performance-client";

const supportedMetrics = new Set([
  "TTFB",
  "FCP",
  "LCP",
  "CLS",
  "INP",
]);

export function WebVitals() {
  useReportWebVitals((metric) => {
    if (!supportedMetrics.has(metric.name)) return;

    enqueuePerformanceEvent({
      kind: "web-vital",
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      route: normalizeClientRoute(window.location.pathname),
      navigationType: metric.navigationType,
    });
  });

  return null;
}
