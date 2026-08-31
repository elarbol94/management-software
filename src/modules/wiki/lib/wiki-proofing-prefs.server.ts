import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userProfilePreferences } from "@/db/schema";
import { parseWikiProofingPrefs } from "./wiki-proofing-prefs";

export function getWikiProofingPrefsForUser(userId: string) {
  const stored = db.select({ value: userProfilePreferences.wikiProofingJson })
    .from(userProfilePreferences)
    .where(eq(userProfilePreferences.userId, userId))
    .get();
  return parseWikiProofingPrefs(stored?.value);
}
