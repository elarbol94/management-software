import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProfilePreferences } from "@/db/schema";
import {
  DEFAULT_USER_MARK_COLOR,
  USER_MARK_COLORS,
  isUserMarkColor,
  type UserMarkColor,
} from "./user-mark-colors";

export const MARK_COLOR_PALETTE_EXHAUSTED =
  "All personal marking colors are assigned. Expand the marking-color palette before creating another user.";

export function ensureUserMarkColor(userId: string): UserMarkColor {
  const existing = db.select({ markColor: userProfilePreferences.markColor })
    .from(userProfilePreferences)
    .where(eq(userProfilePreferences.userId, userId))
    .get();
  if (existing && isUserMarkColor(existing.markColor)) return existing.markColor;

  const used = new Set(db.select({ markColor: userProfilePreferences.markColor })
    .from(userProfilePreferences).all().map((row) => row.markColor));
  for (const color of USER_MARK_COLORS) {
    if (used.has(color.key)) continue;
    try {
      db.insert(userProfilePreferences).values({
        userId,
        markColor: color.key,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: userProfilePreferences.userId,
        set: { markColor: color.key, updatedAt: new Date() },
      }).run();
      return color.key;
    } catch (error) {
      if (!(error instanceof Error) || !/unique/i.test(error.message)) throw error;
    }
  }
  throw new Error(MARK_COLOR_PALETTE_EXHAUSTED);
}

export function resolveStoredUserMarkColor(value: unknown): UserMarkColor {
  return isUserMarkColor(value) ? value : DEFAULT_USER_MARK_COLOR;
}
