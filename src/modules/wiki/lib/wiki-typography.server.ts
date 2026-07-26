import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProfilePreferences } from "@/db/schema";
import { parseWikiTypographyProfile } from "./wiki-typography";

export function getWikiTypographyProfileForUser(userId: string) {
  const stored = db.select({ value: userProfilePreferences.wikiTypographyJson })
    .from(userProfilePreferences)
    .where(eq(userProfilePreferences.userId, userId))
    .get();
  return parseWikiTypographyProfile(stored?.value);
}

export function getWikiTypographyForUser(userId: string) {
  return getWikiTypographyProfileForUser(userId).typography;
}
