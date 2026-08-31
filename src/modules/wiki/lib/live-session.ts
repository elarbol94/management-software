import { z } from "zod";

/**
 * Remote follow: viewers on other devices mirror the presenter's current stop by polling
 * a live session. There is no push channel anywhere in this app, so this is a plain
 * short-interval poll — the payload is one integer, so it stays cheap.
 *
 * The same-browser presenter-notes window keeps using BroadcastChannel (`./presenter.ts`);
 * the two paths are independent.
 */

/** Poll cadence for followers: fast enough to feel live, slow enough to be boring. */
export const LIVE_SESSION_POLL_MS = 1_500;

/** How often the host refreshes the session while nothing moves. */
export const LIVE_SESSION_HEARTBEAT_MS = 10_000;

/** A session whose host stopped refreshing is treated as over. */
export const LIVE_SESSION_STALE_MS = 45_000;

/**
 * No 0/O/1/I/L/S/5 — the code gets read off a projector and typed on a phone, and those
 * are exactly the pairs people get wrong.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRTUVWXYZ2346789";
export const LIVE_SESSION_CODE_LENGTH = 6;

export function generateLiveSessionCode(random: () => number = Math.random): string {
  let code = "";
  for (let position = 0; position < LIVE_SESSION_CODE_LENGTH; position += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * What a viewer typed, turned into what is stored: upper case, spaces and dashes dropped.
 * Returns null when the result could not be a code, so the caller can reject before it
 * ever reaches the database.
 */
export function normalizeLiveSessionCode(input: string): string | null {
  const normalized = input.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (normalized.length !== LIVE_SESSION_CODE_LENGTH) return null;
  for (const character of normalized) {
    if (!CODE_ALPHABET.includes(character)) return null;
  }
  return normalized;
}

/** Zod form of the above, for action and route-handler input. */
export const liveSessionCodeSchema = z
  .string()
  .max(32)
  .transform((value) => normalizeLiveSessionCode(value))
  .refine((value): value is string => value !== null, { message: "Invalid live session code" });

export const liveStepIndexSchema = z.number().int().min(0).max(10_000);

export function isLiveSessionStale(heartbeatAt: number, now: number): boolean {
  return now - heartbeatAt > LIVE_SESSION_STALE_MS;
}

export function liveSessionFollowPath(code: string): string {
  return `/wiki/presentations/follow/${code}`;
}

/** Shape the follow poll returns; parsed on the client so a stray response cannot crash it. */
export const liveSessionPositionSchema = z.object({
  stepIndex: z.number().int().min(0),
  live: z.boolean(),
});
export type LiveSessionPosition = z.infer<typeof liveSessionPositionSchema>;
