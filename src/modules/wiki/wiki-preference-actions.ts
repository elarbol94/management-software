"use server";

import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { userProfilePreferences } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { ensureUserMarkColor } from "@/lib/user-mark-colors.server";
import {
  MAX_WIKI_TYPOGRAPHY_TEMPLATES,
  normalizeWikiTypography,
  serializeWikiTypographyProfile,
  type WikiTypographyTemplate,
  type WikiTypographySettingsV1,
} from "./lib/wiki-typography";
import { getWikiTypographyProfileForUser } from "./lib/wiki-typography.server";

export async function updateMyWikiTypography(input: WikiTypographySettingsV1) {
  const currentUser = await requireUserOrThrow();
  const typography = normalizeWikiTypography(input);
  ensureUserMarkColor(currentUser.id);
  const profile = getWikiTypographyProfileForUser(currentUser.id);
  db.update(userProfilePreferences)
    .set({
      wikiTypographyJson: serializeWikiTypographyProfile({ ...profile, typography }),
      updatedAt: new Date(),
    })
    .where(eq(userProfilePreferences.userId, currentUser.id))
    .run();
  revalidatePath("/wiki", "layout");
  return typography;
}

const saveTypographyTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  typography: z.unknown(),
});

export async function saveMyWikiTypographyTemplate(input: z.infer<typeof saveTypographyTemplateSchema>) {
  const currentUser = await requireUserOrThrow();
  const data = saveTypographyTemplateSchema.parse(input);
  ensureUserMarkColor(currentUser.id);
  const profile = getWikiTypographyProfileForUser(currentUser.id);
  if (profile.templates.length >= MAX_WIKI_TYPOGRAPHY_TEMPLATES) {
    throw new Error("Template limit reached");
  }
  const template: WikiTypographyTemplate = {
    id: createId(),
    name: data.name,
    typography: normalizeWikiTypography(data.typography),
    createdAt: Date.now(),
  };
  db.update(userProfilePreferences)
    .set({
      wikiTypographyJson: serializeWikiTypographyProfile({
        ...profile,
        templates: [...profile.templates, template],
      }),
      updatedAt: new Date(),
    })
    .where(eq(userProfilePreferences.userId, currentUser.id))
    .run();
  revalidatePath("/wiki", "layout");
  return template;
}

export async function deleteMyWikiTypographyTemplate(templateId: string) {
  const currentUser = await requireUserOrThrow();
  const id = z.string().trim().min(1).max(120).parse(templateId);
  const profile = getWikiTypographyProfileForUser(currentUser.id);
  const templates = profile.templates.filter((template) => template.id !== id);
  if (templates.length === profile.templates.length) return false;
  db.update(userProfilePreferences)
    .set({
      wikiTypographyJson: serializeWikiTypographyProfile({ ...profile, templates }),
      updatedAt: new Date(),
    })
    .where(eq(userProfilePreferences.userId, currentUser.id))
    .run();
  revalidatePath("/wiki", "layout");
  return true;
}
