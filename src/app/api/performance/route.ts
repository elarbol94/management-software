import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { performanceEvents } from "@/db/schema";
import {
  cleanupPerformanceEvents,
  normalizePerformanceRoute,
  performanceBuildId,
} from "@/lib/performance";

const eventSchema = z.object({
  kind: z.enum(["web-vital", "operation"]),
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9_.:-]+$/),
  value: z.number().finite().nonnegative().max(3_600_000),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  route: z.string().min(1).max(240),
  navigationType: z.string().max(30).optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(20),
});

export async function POST(request: Request) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 24_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid metrics" }, { status: 400 });
  }

  db.insert(performanceEvents)
    .values(
      parsed.data.events.map((event) => ({
        ...event,
        route: normalizePerformanceRoute(event.route),
        buildId: performanceBuildId,
      })),
    )
    .run();
  if (Math.random() < 0.01) cleanupPerformanceEvents();

  return new NextResponse(null, { status: 204 });
}
