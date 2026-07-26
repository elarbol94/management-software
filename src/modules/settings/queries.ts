import { db } from "@/db";
import { eq } from "drizzle-orm";
import { appSettings, businessLocations, user, userProfilePreferences } from "@/db/schema";
import { USER_MARK_COLORS } from "@/lib/user-mark-colors";
import { ensureUserMarkColor } from "@/lib/user-mark-colors.server";

export type AppSettings = typeof appSettings.$inferSelect;

const defaults: AppSettings = {
  id: "default",
  companyName: "",
  address: "",
  uid: "",
  iban: "",
  bic: "",
  kleinunternehmer: false,
  invoicePrefix: "",
  defaultVatRate: 20,
  updatedAt: new Date(0),
};

export function getAppSettings(): AppSettings {
  return db.select().from(appSettings).get() ?? defaults;
}

export function listUsers() {
  return db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      displayUsername: user.displayUsername,
      email: user.email,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(user.createdAt)
    .all();
}

export function listAllBusinessLocations() {
  return db.select().from(businessLocations).orderBy(businessLocations.name).all();
}

export function getMyProfilePreferences(userId: string) {
  const markColor = ensureUserMarkColor(userId);
  return db.select().from(userProfilePreferences)
    .where(eq(userProfilePreferences.userId, userId)).get()
    ?? { userId, markColor, wikiTypographyJson: "", updatedAt: new Date() };
}

export function listMarkColorAvailability(userId: string) {
  ensureUserMarkColor(userId);
  const owners = new Map(db.select({
    markColor: userProfilePreferences.markColor,
    userId: userProfilePreferences.userId,
    userName: user.name,
  }).from(userProfilePreferences)
    .innerJoin(user, eq(userProfilePreferences.userId, user.id))
    .all().map((row) => [row.markColor, row]));
  return USER_MARK_COLORS.map((color) => {
    const owner = owners.get(color.key);
    return {
      key: color.key,
      available: !owner || owner.userId === userId,
      mine: owner?.userId === userId,
      ownerName: owner?.userName ?? null,
    };
  });
}
