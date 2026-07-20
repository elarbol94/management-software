import { db } from "@/db";
import { appSettings, businessLocations, user } from "@/db/schema";

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
