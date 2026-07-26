"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userProfilePreferences } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { ensureUserMarkColor } from "@/lib/user-mark-colors.server";
import {
  normalizeWikiTypography,
  serializeWikiTypography,
  type WikiTypographySettingsV1,
} from "./lib/wiki-typography";

export async function updateMyWikiTypography(input: WikiTypographySettingsV1) {
  const currentUser = await requireUserOrThrow();
  const typography = normalizeWikiTypography(input);
  ensureUserMarkColor(currentUser.id);
  db.update(userProfilePreferences)
    .set({
      wikiTypographyJson: serializeWikiTypography(typography),
      updatedAt: new Date(),
    })
    .where(eq(userProfilePreferences.userId, currentUser.id))
    .run();
  revalidatePath("/wiki", "layout");
  return typography;
}
