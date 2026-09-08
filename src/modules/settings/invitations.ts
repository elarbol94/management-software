import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { db } from "@/db";
import { account, user } from "@/db/schema";
import { MailConfigurationError, sendMail } from "@/lib/mail";
import { ensureUserMarkColor } from "@/lib/user-mark-colors.server";
import { userInvitations } from "./schema";
import { acceptInvitationSchema, invitationTokenSchema, type InviteUserInput } from "./user-input";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const activeInvitation = (token: string) => and(
  eq(userInvitations.tokenHash, tokenHash(token)),
  isNotNull(userInvitations.sentAt),
  isNull(userInvitations.acceptedAt),
  gt(userInvitations.expiresAt, new Date()),
);

function emailExists(email: string) {
  return db.select({ id: user.id }).from(user)
    .where(sql`lower(${user.email}) = ${email}`).get();
}

export async function issueInvitation(input: InviteUserInput, invitedBy: string, locale: string) {
  if (emailExists(input.email)) return { error: "emailTaken" as const };
  const token = randomBytes(32).toString("hex");
  let url: URL;
  try {
    url = new URL("/invite", process.env.BETTER_AUTH_URL!);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    url.searchParams.set("token", token);
  } catch {
    return { error: "mailNotConfigured" as const };
  }
  const language = locale === "en" ? "en" : "de";
  const messages = (await import(`../../../messages/${language}.json`)).default;
  const t = createTranslator({ locale: language, messages, namespace: "invitationEmail" });
  const now = new Date();
  const invitation = db.insert(userInvitations).values({
    ...input, invitedBy, tokenHash: tokenHash(token), createdAt: now,
    expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS),
  }).returning({ id: userInvitations.id }).get();

  try {
    await sendMail({ to: input.email, subject: t("subject"), text: t("body", { url: url.toString() }) });
  } catch (error) {
    // A failed resend must leave the previously delivered invitation usable.
    db.delete(userInvitations).where(eq(userInvitations.id, invitation.id)).run();
    return { error: error instanceof MailConfigurationError ? "mailNotConfigured" as const : "mailFailed" as const };
  }

  return db.transaction((tx) => {
    // An earlier link might have been accepted while this email was in flight.
    if (emailExists(input.email)) {
      tx.delete(userInvitations).where(eq(userInvitations.id, invitation.id)).run();
      return { error: "emailTaken" as const };
    }
    const activated = tx.update(userInvitations).set({ sentAt: new Date() })
      .where(eq(userInvitations.id, invitation.id)).returning({ id: userInvitations.id }).get();
    if (!activated) return { error: "mailFailed" as const };
    // Only delivered links are replaced. Other sends may still be in flight.
    tx.delete(userInvitations).where(and(
      eq(userInvitations.email, input.email), ne(userInvitations.id, invitation.id),
      isNotNull(userInvitations.sentAt), isNull(userInvitations.acceptedAt),
    )).run();
    return { error: null };
  }, { behavior: "immediate" });
}

/** Reading or previewing an email link never consumes it. */
export function getInvitation(token: string) {
  if (!invitationTokenSchema.safeParse(token).success) return null;
  return db.select({ email: userInvitations.email }).from(userInvitations)
    .where(activeInvitation(token)).get() ?? null;
}

export function listPendingInvitations() {
  return db.select({
    id: userInvitations.id, email: userInvitations.email,
    role: userInvitations.role, expiresAt: userInvitations.expiresAt,
  }).from(userInvitations).where(and(
    isNotNull(userInvitations.sentAt), isNull(userInvitations.acceptedAt),
    gt(userInvitations.expiresAt, new Date()),
  )).orderBy(userInvitations.createdAt).all();
}

export async function acceptInvitation(input: unknown) {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) return { error: "invalidInput" as const };
  const { token, nickname, password } = parsed.data;
  // Reject invalid links before the deliberately expensive password hash.
  if (!getInvitation(token)) return { error: "invalidInvitation" as const };
  const hashedPassword = await hashPassword(password);

  // SQLite transactions are synchronous. Keep hashing outside, then claim the
  // link and create the Better Auth credential together under a write lock.
  return db.transaction((tx) => {
    const invitation = tx.select().from(userInvitations).where(activeInvitation(token)).get();
    if (!invitation) return { error: "invalidInvitation" as const };
    if (emailExists(invitation.email)) return { error: "emailTaken" as const };
    const username = nickname.toLowerCase();
    if (tx.select({ id: user.id }).from(user).where(sql`lower(${user.username}) = ${username}`).get()) {
      return { error: "usernameTaken" as const };
    }
    const now = new Date();
    const claimed = tx.update(userInvitations).set({ acceptedAt: now })
      .where(activeInvitation(token)).returning({ id: userInvitations.id }).get();
    if (!claimed) return { error: "invalidInvitation" as const };

    const userId = randomUUID();
    tx.insert(user).values({
      id: userId, name: nickname, username, displayUsername: nickname,
      email: invitation.email, emailVerified: true, role: invitation.role,
      createdAt: now, updatedAt: now,
    }).run();
    tx.insert(account).values({
      id: randomUUID(), accountId: userId, providerId: "credential", userId,
      password: hashedPassword, createdAt: now, updatedAt: now,
    }).run();
    ensureUserMarkColor(userId);
    return { error: null };
  }, { behavior: "immediate" });
}
