"use server";

import { APIError } from "better-auth/api";
import { revalidatePath } from "next/cache";
import { auth, requireAdmin } from "@/lib/auth";
import { createUserSchema, type CreateUserInput } from "./user-input";

export async function createPlatformUser(input: CreateUserInput) {
  await requireAdmin();
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return { error: "invalidInput" as const };

  const { username, ...data } = parsed.data;
  try {
    // Authorization is enforced above, including the documented local dev session.
    // Better Auth hashes the password and creates the credential account.
    await auth.api.createUser({
      body: { ...data, data: { username, displayUsername: username } },
    });
  } catch (error) {
    if (error instanceof APIError) {
      if (error.body?.code === "USERNAME_IS_ALREADY_TAKEN") {
        return { error: "usernameTaken" as const };
      }
      if (error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
        return { error: "emailTaken" as const };
      }
    }
    throw error;
  }

  revalidatePath("/settings/users");
  return { error: null };
}
