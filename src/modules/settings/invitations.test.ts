import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: "drizzle" });
  return { db, sqlite };
});
vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn(),
  MailConfigurationError: class MailConfigurationError extends Error {},
}));

import { db, sqlite } from "@/db";
import { account, user, userInvitations, userProfilePreferences } from "@/db/schema";
import { MailConfigurationError, sendMail } from "@/lib/mail";
import { acceptInvitation, getInvitation, issueInvitation, listPendingInvitations } from "./invitations";

const mail = vi.mocked(sendMail);
const invite = { email: "invitee@example.com", role: "personnel" as const };
const credentials = { nickname: "New.Colleague", password: "a-strong-test-password", confirmPassword: "a-strong-test-password" };
function latestToken() {
  const text = mail.mock.calls.at(-1)![0].text;
  return new URL(text.match(/http[^\s]+/)![0]).searchParams.get("token")!;
}
async function sendInvite() {
  expect(await issueInvitation(invite, "admin", "en")).toEqual({ error: null });
  return latestToken();
}
beforeEach(() => {
  mail.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("BETTER_AUTH_URL", "https://app.example.com");
  db.delete(user).run();
  db.insert(user).values({ id: "admin", name: "Admin", username: "admin", email: "admin@example.com", role: "admin", createdAt: new Date(), updatedAt: new Date() }).run();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => sqlite.close());

describe("email invitations", () => {
  it("sends a localized link, stores only its hash, and creates no account on send or preview", async () => {
    const token = await sendInvite();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(mail.mock.calls[0][0]).toMatchObject({ to: invite.email, subject: "Your invitation to management-platform" });
    const stored = db.select().from(userInvitations).get()!;
    expect(stored.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(7 * 86400 * 1000);
    expect(getInvitation(token)).toEqual({ email: invite.email });
    expect(getInvitation(token)).toEqual({ email: invite.email });
    expect(db.select().from(user).all()).toHaveLength(1);
    expect(listPendingInvitations()).toHaveLength(1);
    expect(db.select().from(userInvitations).get()?.acceptedAt).toBeNull();
  });

  it("creates a working hashed credential using the stored email and role, then rejects reuse", async () => {
    const token = await sendInvite();
    expect(await acceptInvitation({ token, ...credentials, email: "attacker@example.com", role: "admin" })).toEqual({ error: null });
    const created = db.select().from(user).where(eq(user.email, invite.email)).get()!;
    expect(created).toMatchObject({ name: credentials.nickname, username: "new.colleague", displayUsername: credentials.nickname, emailVerified: true, role: invite.role });
    const credential = db.select().from(account).where(eq(account.userId, created.id)).get()!;
    expect(credential).toMatchObject({ accountId: created.id, providerId: "credential" });
    expect(credential.password).not.toBe(credentials.password);
    expect(await verifyPassword({ hash: credential.password!, password: credentials.password })).toBe(true);
    expect(db.select().from(userProfilePreferences).where(eq(userProfilePreferences.userId, created.id)).get()).toBeTruthy();
    expect(getInvitation(token)).toBeNull();
    expect(await acceptInvitation({ token, ...credentials, nickname: "Another" })).toEqual({ error: "invalidInvitation" });
    expect(db.select().from(account).all()).toHaveLength(1);
    expect(listPendingInvitations()).toEqual([]);
  });

  it("allows only one simultaneous acceptance", async () => {
    const token = await sendInvite();
    const results = await Promise.all([
      acceptInvitation({ token, ...credentials }),
      acceptInvitation({ token, ...credentials, nickname: "Other.Nickname" }),
    ]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.filter((result) => result.error === "invalidInvitation")).toHaveLength(1);
    expect(db.select().from(account).all()).toHaveLength(1);
  });

  it("rejects unknown, malformed, expired and undelivered tokens", async () => {
    const token = await sendInvite();
    expect(getInvitation("bad")).toBeNull();
    expect(await acceptInvitation({ ...credentials, token: "a".repeat(64) })).toEqual({ error: "invalidInvitation" });
    db.update(userInvitations).set({ sentAt: null }).run();
    expect(getInvitation(token)).toBeNull();
    expect(await acceptInvitation({ ...credentials, token })).toEqual({ error: "invalidInvitation" });
    db.update(userInvitations).set({ sentAt: new Date(), expiresAt: new Date(Date.now() - 1000) }).run();
    expect(getInvitation(token)).toBeNull();
    expect(await acceptInvitation({ ...credentials, token })).toEqual({ error: "invalidInvitation" });
    expect(db.select().from(account).all()).toHaveLength(0);
  });

  it.each([
    { nickname: "ab" }, { nickname: "contains space" }, { nickname: "x".repeat(201) },
    { password: "short", confirmPassword: "short" },
    { password: "x".repeat(129), confirmPassword: "x".repeat(129) },
    { confirmPassword: "different-password" },
  ])("keeps the link usable after invalid credentials: %j", async (invalid) => {
    const token = await sendInvite();
    expect(await acceptInvitation({ token, ...credentials, ...invalid })).toEqual({ error: "invalidInput" });
    expect(getInvitation(token)).toBeTruthy();
    expect(db.select().from(account).all()).toHaveLength(0);
  });

  it("lets a recipient correct a duplicate nickname without consuming the invitation", async () => {
    const token = await sendInvite();
    expect(await acceptInvitation({ token, ...credentials, nickname: "ADMIN" })).toEqual({ error: "usernameTaken" });
    expect(getInvitation(token)).toBeTruthy();
    expect(await acceptInvitation({ token, ...credentials })).toEqual({ error: null });
  });

  it("rolls back account creation and token consumption when a credential write fails", async () => {
    const token = await sendInvite();
    sqlite.exec("CREATE TRIGGER fail_credential BEFORE INSERT ON account BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
    try {
      await expect(acceptInvitation({ token, ...credentials })).rejects.toThrow();
      expect(getInvitation(token)).toBeTruthy();
      expect(db.select().from(user).all()).toHaveLength(1);
      expect(db.select().from(account).all()).toHaveLength(0);
    } finally {
      sqlite.exec("DROP TRIGGER fail_credential");
    }
    expect(await acceptInvitation({ token, ...credentials })).toEqual({ error: null });
  });

  it("replaces old links on resend but preserves them if email delivery fails", async () => {
    const first = await sendInvite();
    mail.mockRejectedValueOnce(new Error("SMTP unavailable"));
    expect(await issueInvitation(invite, "admin", "en")).toEqual({ error: "mailFailed" });
    expect(getInvitation(latestToken())).toBeNull();
    expect(getInvitation(first)).toBeTruthy();
    const second = await sendInvite();
    expect(second).not.toBe(first);
    expect(getInvitation(first)).toBeNull();
    expect(getInvitation(second)).toBeTruthy();
    expect(listPendingInvitations()).toHaveLength(1);
  });

  it("does not leave a pending resend if the original link is accepted during delivery", async () => {
    const token = await sendInvite();
    mail.mockImplementationOnce(async () => {
      expect(await acceptInvitation({ ...credentials, token })).toEqual({ error: null });
    });
    expect(await issueInvitation(invite, "admin", "en")).toEqual({ error: "emailTaken" });
    expect(getInvitation(latestToken())).toBeNull();
    expect(listPendingInvitations()).toEqual([]);
    expect(db.select().from(account).all()).toHaveLength(1);
  });

  it("rejects existing email addresses and accounts created while an invitation was pending", async () => {
    expect(await issueInvitation({ ...invite, email: "admin@example.com" }, "admin", "en")).toEqual({ error: "emailTaken" });
    expect(mail).not.toHaveBeenCalled();
    const token = await sendInvite();
    db.insert(user).values({ id: "existing", name: "Existing", email: invite.email, createdAt: new Date(), updatedAt: new Date() }).run();
    expect(await acceptInvitation({ ...credentials, token })).toEqual({ error: "emailTaken" });
    expect(db.select().from(account).all()).toHaveLength(0);
  });

  it("reports missing SMTP or public URL configuration", async () => {
    mail.mockRejectedValueOnce(new MailConfigurationError("missing SMTP"));
    expect(await issueInvitation(invite, "admin", "en")).toEqual({ error: "mailNotConfigured" });
    expect(db.select().from(userInvitations).all()).toHaveLength(0);
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(await issueInvitation(invite, "admin", "en")).toEqual({ error: "mailNotConfigured" });
  });

  it("sends German invitation text", async () => {
    expect(await issueInvitation(invite, "admin", "de")).toEqual({ error: null });
    expect(mail.mock.calls[0][0].subject).toBe("Deine Einladung zu management-platform");
    expect(mail.mock.calls[0][0].text).toContain("7 Tagen");
  });
});
