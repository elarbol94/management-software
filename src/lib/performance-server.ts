import "server-only";

import { db } from "@/db";
import { performanceEvents } from "@/db/schema";
import {
  normalizePerformanceRoute,
  performanceBuildId,
} from "@/lib/performance";

export function measureServerOperation<T>(
  route: string,
  name: string,
  operation: () => T,
): T {
  const sampled = process.env.NODE_ENV === "production" && Math.random() < 0.1;
  if (!sampled) return operation();

  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    db.insert(performanceEvents)
      .values({
        kind: "operation",
        name,
        value: performance.now() - startedAt,
        route: normalizePerformanceRoute(route),
        buildId: performanceBuildId,
      })
      .run();
  }
}
