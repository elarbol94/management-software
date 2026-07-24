"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appSettings, businessLocations, userProfilePreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, requireUserOrThrow } from "@/lib/auth";
import { payrollStates } from "@/modules/accounting/lib/payroll-at-2026";
import { USER_MARK_COLORS, type UserMarkColor } from "@/lib/user-mark-colors";
import { ensureUserMarkColor } from "@/lib/user-mark-colors.server";

const settingsSchema = z.object({
  companyName: z.string().max(200),
  address: z.string().max(1000),
  uid: z.string().max(50),
  iban: z.string().max(50),
  bic: z.string().max(20),
  kleinunternehmer: z.boolean(),
  invoicePrefix: z.string().max(20),
  defaultVatRate: z.union([
    z.literal(20),
    z.literal(13),
    z.literal(10),
    z.literal(0),
  ]),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export async function updateAppSettings(input: SettingsInput) {
  await requireAdmin();
  const data = settingsSchema.parse(input);

  db.insert(appSettings)
    .values({ id: "default", ...data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { ...data, updatedAt: new Date() },
    })
    .run();

  revalidatePath("/settings");
}

const businessLocationSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  state: z.enum(payrollStates),
  municipality: z.string().trim().min(1).max(120),
  active: z.boolean().default(true),
});

export type BusinessLocationInput = z.infer<typeof businessLocationSchema>;

export async function upsertBusinessLocation(input: BusinessLocationInput) {
  await requireAdmin();
  const data = businessLocationSchema.parse(input);
  if (data.id) {
    db.update(businessLocations).set(data).where(eq(businessLocations.id, data.id)).run();
  } else {
    db.insert(businessLocations).values(data).run();
  }
  revalidatePath("/settings/locations");
  revalidatePath("/accounting");
}

export async function setBusinessLocationActive(id: string, active: boolean) {
  await requireAdmin();
  db.update(businessLocations).set({ active }).where(eq(businessLocations.id, id)).run();
  revalidatePath("/settings/locations");
  revalidatePath("/accounting");
}

const markColorSchema = z.enum(USER_MARK_COLORS.map((color) => color.key) as [
  UserMarkColor,
  ...UserMarkColor[],
]);

export async function updateMyMarkColor(input: UserMarkColor) {
  const currentUser = await requireUserOrThrow();
  const markColor = markColorSchema.parse(input);
  ensureUserMarkColor(currentUser.id);
  try {
    db.update(userProfilePreferences)
      .set({ markColor, updatedAt: new Date() })
      .where(eq(userProfilePreferences.userId, currentUser.id))
      .run();
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      return { ok: false as const, reason: "conflict" as const };
    }
    throw error;
  }
  revalidatePath("/settings/profile");
  revalidatePath("/wiki", "layout");
  revalidatePath("/", "layout");
  return { ok: true as const, markColor };
}
