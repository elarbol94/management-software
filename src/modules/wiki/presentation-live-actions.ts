"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { wikiPresentationLiveSessions, wikiPresentations } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import {
  generateLiveSessionCode,
  liveStepIndexSchema,
  liveSessionCodeSchema,
} from "./lib/live-session";

const idSchema = z.string().min(1).max(64);

/**
 * Starting a live session replaces whatever session that presentation had, the same way
 * the edit lease is upserted: a talk has one current position, and restarting hands out a
 * fresh code so a link from a previous run stops working.
 */
export async function startPresentationLiveSession(input: { presentationId: string; stepIndex?: number }) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({ presentationId: idSchema, stepIndex: liveStepIndexSchema.default(0) })
    .parse(input);
  const presentation = db
    .select({ id: wikiPresentations.id })
    .from(wikiPresentations)
    .where(eq(wikiPresentations.id, data.presentationId))
    .get();
  if (!presentation) throw new Error("Presentation not found");

  const now = new Date();
  // ponytail: retry on the unique code index instead of locking. 29^6 codes against a
  // handful of concurrent talks means this loop effectively never runs twice.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateLiveSessionCode();
    const taken = db
      .select({ presentationId: wikiPresentationLiveSessions.presentationId })
      .from(wikiPresentationLiveSessions)
      .where(eq(wikiPresentationLiveSessions.code, code))
      .get();
    if (taken && taken.presentationId !== data.presentationId) continue;
    db.insert(wikiPresentationLiveSessions)
      .values({
        presentationId: data.presentationId,
        code,
        hostUserId: currentUser.id,
        stepIndex: data.stepIndex,
        startedAt: now,
        heartbeatAt: now,
      })
      .onConflictDoUpdate({
        target: wikiPresentationLiveSessions.presentationId,
        set: { code, hostUserId: currentUser.id, stepIndex: data.stepIndex, startedAt: now, heartbeatAt: now },
      })
      .run();
    return { code };
  }
  throw new Error("Could not allocate a live session code");
}

/**
 * The host's position update, which doubles as its heartbeat. Scoped to the host's own
 * session, so a second presenter who took the presentation over is not steered by the
 * stale tab of the first one.
 */
export async function publishPresentationLivePosition(input: {
  presentationId: string;
  code: string;
  stepIndex: number;
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({ presentationId: idSchema, code: liveSessionCodeSchema, stepIndex: liveStepIndexSchema })
    .parse(input);
  const updated = db
    .update(wikiPresentationLiveSessions)
    .set({ stepIndex: data.stepIndex, heartbeatAt: new Date() })
    .where(and(
      eq(wikiPresentationLiveSessions.presentationId, data.presentationId),
      eq(wikiPresentationLiveSessions.code, data.code),
      eq(wikiPresentationLiveSessions.hostUserId, currentUser.id),
    ))
    .returning({ presentationId: wikiPresentationLiveSessions.presentationId })
    .get();
  return { live: Boolean(updated) };
}

/**
 * End the host's own session. A caller that holds a code should pass it: restarting the
 * talk in a second tab replaces the row with a new code, and without the code the first
 * tab's exit would delete that replacement. Omitting it keeps the older "whatever session
 * I host for this presentation" behaviour.
 */
export async function stopPresentationLiveSession(input: { presentationId: string; code?: string }) {
  const currentUser = await requireUserOrThrow();
  const data = z.object({ presentationId: idSchema, code: liveSessionCodeSchema.optional() }).parse(input);
  db.delete(wikiPresentationLiveSessions)
    .where(and(
      eq(wikiPresentationLiveSessions.presentationId, data.presentationId),
      eq(wikiPresentationLiveSessions.hostUserId, currentUser.id),
      data.code ? eq(wikiPresentationLiveSessions.code, data.code) : undefined,
    ))
    .run();
  return { stopped: true as const };
}
