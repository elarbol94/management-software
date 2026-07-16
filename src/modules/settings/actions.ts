"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

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
