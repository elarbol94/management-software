import {
  enqueuePerformanceEvent,
  normalizeClientRoute,
} from "@/lib/performance-client";

export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  const startedAt = performance.now();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      enqueuePerformanceEvent({
        kind: "operation",
        name: "navigation-feedback",
        value: performance.now() - startedAt,
        route: normalizeClientRoute(new URL(url, window.location.href).pathname),
        navigationType,
      });
    });
  });
}
