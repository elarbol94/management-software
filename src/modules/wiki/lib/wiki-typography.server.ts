import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProfilePreferences } from "@/db/schema";
import { parseWikiTypography } from "./wiki-typography";

export function getWikiTypographyForUser(userId: string) {
  const stored = db.select({ value: userProfilePreferences.wikiTypographyJson })
    .from(userProfilePreferences)
    .where(eq(userProfilePreferences.userId, userId))
    .get();
  return parseWikiTypography(stored?.value);
}
