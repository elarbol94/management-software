export type ClientPerformanceEvent = {
  kind: "web-vital" | "operation";
  name: string;
  value: number;
  rating?: "good" | "needs-improvement" | "poor";
  route: string;
  navigationType?: string;
};

const queue: ClientPerformanceEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export function normalizeClientRoute(pathname: string) {
  return pathname
    .split("?")[0]
    .replace(/\/[a-z0-9_-]{20,}(?=\/|$)/gi, "/[id]")
    .replace(/\/\d+(?=\/|$)/g, "/[id]");
}

function flush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (queue.length === 0) return;
  const payload = JSON.stringify({ events: queue.splice(0, 20) });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/performance",
      new Blob([payload], { type: "application/json" }),
    );
  } else {
    void fetch("/api/performance", {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    });
  }

  if (queue.length > 0) flushTimer = setTimeout(flush, 250);
}

export function enqueuePerformanceEvent(event: ClientPerformanceEvent) {
  queue.push(event);
  if (queue.length >= 20) {
    flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flush, 2_000);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush, { capture: true });
}
