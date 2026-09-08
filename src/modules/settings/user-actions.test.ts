import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), issueInvitation: vi.fn(), acceptInvitation: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("./invitations", () => ({ issueInvitation: mocks.issueInvitation, acceptInvitation: mocks.acceptInvitation }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));

import { invitePlatformUser } from "./user-actions";
const input = { email: "colleague@example.com", role: "member" as const };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ id: "admin", role: "admin" });
  mocks.issueInvitation.mockResolvedValue({ error: null });
});

describe("invitePlatformUser", () => {
  it.each(["Unauthorized", "Forbidden"])("rejects %s callers before sending an invitation", async (message) => {
    mocks.requireAdmin.mockRejectedValue(new Error(message));
    await expect(invitePlatformUser(input)).rejects.toThrow(message);
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([{ email: "invalid" }, { email: "a@example.com\r\nBcc: b@example.com" }, { role: "superadmin" }])("rejects invalid invitation data: %j", async (invalid) => {
    expect(await invitePlatformUser({ ...input, ...invalid } as typeof input)).toEqual({ error: "invalidInput" });
    expect(mocks.issueInvitation).not.toHaveBeenCalled();
  });

  it.each(["member", "personnel", "admin"] as const)("stores the selected %s role and normalizes email", async (role) => {
    expect(await invitePlatformUser({ ...input, role, email: " Colleague@Example.com " })).toEqual({ error: null });
    expect(mocks.issueInvitation).toHaveBeenCalledWith({ email: input.email, role }, "admin", "en");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it.each(["emailTaken", "mailNotConfigured", "mailFailed"])("returns the %s delivery error without reporting success", async (error) => {
    mocks.issueInvitation.mockResolvedValue({ error });
    expect(await invitePlatformUser(input)).toEqual({ error });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
