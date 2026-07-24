import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { admin, username } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ensureUserMarkColor } from "@/lib/user-mark-colors.server";

function userCount(): number {
  return db.select({ value: count() }).from(schema.user).get()?.value ?? 0;
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once per day (sliding expiry)
  },
  hooks: {
    // Public signup only bootstraps the very first account (the admin).
    // Afterwards accounts are created by admins via the admin plugin.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email" && userCount() > 0) {
        throw new APIError("FORBIDDEN", {
          message: "Signup is disabled. Ask an administrator for an account.",
        });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: { ...user, role: userCount() === 0 ? "admin" : "member" },
        }),
        after: async (createdUser) => {
          ensureUserMarkColor(createdUser.id);
        },
      },
    },
  },
  plugins: [
    username({
      maxUsernameLength: 254,
      usernameValidator: (value) => /^[a-zA-Z0-9_.@+-]+$/.test(value),
    }),
    admin({ defaultRole: "member", adminRoles: ["admin"] }),
    nextCookies(),
  ],
});

export type SessionUser = typeof auth.$Infer.Session.user;

function getLocalDevelopmentSession(): typeof auth.$Infer.Session | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.LOCAL_AUTH_BYPASS !== "true"
  ) {
    return null;
  }

  const localUser = db.select().from(schema.user).get();
  if (!localUser) return null;

  const now = new Date();
  return {
    user: localUser,
    session: {
      id: "local-development-session",
      token: "local-development-session",
      userId: localUser.id,
      expiresAt: new Date(now.getTime() + 60 * 60 * 24 * 365 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: "local-development",
      impersonatedBy: null,
    },
  };
}

export async function getSession() {
  const localSession = getLocalDevelopmentSession();
  if (localSession) return localSession;
  return auth.api.getSession({ headers: await headers() });
}

/** Redirects to /login when unauthenticated. Use in pages/layouts. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

/** Throws when unauthenticated. Use in server actions and route handlers. */
export async function requireUserOrThrow(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session.user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUserOrThrow();
  if (user.role !== "admin") throw new Error("Forbidden: admin only");
  return user;
}
