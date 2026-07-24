import { and, asc, count, lt } from "drizzle-orm";
import { db } from "@/db";
import { performanceEvents } from "@/db/schema";

const RETENTION_DAYS = 30;
const MAX_EVENTS = 50_000;

export const performanceBuildId =
  process.env.NEXT_PUBLIC_BUILD_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
  process.env.npm_package_version ??
  "development";

export function normalizePerformanceRoute(value: string) {
  const pathname = value.split("?")[0].slice(0, 180);
  return pathname
    .replace(/\/[a-z0-9_-]{20,}(?=\/|$)/gi, "/[id]")
    .replace(/\/\d+(?=\/|$)/g, "/[id]");
}

export function cleanupPerformanceEvents() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  db.delete(performanceEvents)
    .where(lt(performanceEvents.createdAt, cutoff))
    .run();

  const total =
    db.select({ value: count() }).from(performanceEvents).get()?.value ?? 0;
  const overflow = total - MAX_EVENTS;
  if (overflow <= 0) return;

  const oldest = db
    .select({ id: performanceEvents.id, createdAt: performanceEvents.createdAt })
    .from(performanceEvents)
    .orderBy(asc(performanceEvents.createdAt))
    .limit(overflow)
    .all();
  const boundary = oldest.at(-1);
  if (!boundary) return;

  db.delete(performanceEvents)
    .where(
      and(
        lt(performanceEvents.createdAt, new Date(boundary.createdAt.getTime() + 1)),
      ),
    )
    .run();
}
