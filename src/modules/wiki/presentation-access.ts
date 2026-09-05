import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiPresentationAccess, wikiPresentationMembers, wikiPresentations } from "@/db/schema";

export type PresentationRole = "view" | "comment" | "edit" | "owner";
export class PresentationAccessError extends Error {
  constructor() { super("Presentation access denied"); }
}
export function presentationRole(id: string, viewer: { id: string; role?: string | null }): PresentationRole | null {
  const row = db.select({ createdBy: wikiPresentations.createdBy }).from(wikiPresentations).where(eq(wikiPresentations.id, id)).get();
  if (!row) return null;
  if (row.createdBy === viewer.id || viewer.role === "admin") return "owner";
  const member = db.select().from(wikiPresentationMembers).where(and(eq(wikiPresentationMembers.presentationId, id), eq(wikiPresentationMembers.userId, viewer.id))).get();
  if (member) return member.role;
  return presentationAccessSettings(id)?.restricted ? null : "edit";
}
export function requirePresentationAccess(id: string, viewer: { id: string; role?: string | null }, minimum: PresentationRole = "view") {
  const role = presentationRole(id, viewer);
  const ranks = { view: 0, comment: 1, edit: 2, owner: 3 };
  if (!role || ranks[role] < ranks[minimum]) throw new PresentationAccessError();
  return role;
}
export function presentationAccessSettings(id: string) {
  return db.select().from(wikiPresentationAccess).where(eq(wikiPresentationAccess.presentationId, id)).get();
}
export const presentationTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function presentationIdForToken(token: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.select({ id: wikiPresentationAccess.presentationId }).from(wikiPresentationAccess).where(eq(wikiPresentationAccess.publicTokenHash, presentationTokenHash(token))).get()?.id ?? null;
}
