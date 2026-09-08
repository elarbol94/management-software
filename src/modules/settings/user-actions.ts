"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/auth";
import { inviteUserSchema, type InviteUserInput, type AcceptInvitationInput } from "./user-input";
import { acceptInvitation, issueInvitation } from "./invitations";

export async function invitePlatformUser(input: InviteUserInput) {
  const admin = await requireAdmin();
  const parsed = inviteUserSchema.safeParse(input);
  if (!parsed.success) return { error: "invalidInput" as const };
  const result = await issueInvitation(parsed.data, admin.id, await getLocale());
  if (!result.error) revalidatePath("/settings/users");
  return result;
}

export async function acceptPlatformInvitation(input: AcceptInvitationInput) {
  const result = await acceptInvitation(input);
  if (!result.error) revalidatePath("/settings/users");
  return result;
}
