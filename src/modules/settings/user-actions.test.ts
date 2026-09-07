import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createUser: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
  auth: { api: { createUser: mocks.createUser } },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { createPlatformUser } from "./user-actions";

const input = {
  name: "New Colleague",
  username: "new.colleague",
  email: "colleague@example.com",
  password: "test-password-123",
  role: "member" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdmin.mockResolvedValue({ role: "admin" });
  mocks.createUser.mockResolvedValue({ user: { id: "new-user" } });
});

describe("createPlatformUser", () => {
  it("rejects unauthorized callers before creating an account", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Forbidden"));
    await expect(createPlatformUser(input)).rejects.toThrow("Forbidden");
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { name: "   " },
    { username: "ab" },
    { username: "invalid user" },
    { email: "invalid" },
    { password: "short" },
    { password: "a".repeat(129) },
    { role: "superadmin" },
  ])("rejects invalid account data: %j", async (invalid) => {
    const result = await createPlatformUser({ ...input, ...invalid } as typeof input);
    expect(result.error).toBe("invalidInput");
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["member", "personnel", "admin"] as const)("passes the selected %s role and refreshes users", async (role) => {
    expect(await createPlatformUser({ ...input, role, name: " New Colleague ", email: " Colleague@Example.com " })).toEqual({ error: null });
    expect(mocks.createUser).toHaveBeenCalledWith({ body: {
      name: input.name, email: input.email, password: input.password, role,
      data: { username: input.username, displayUsername: input.username },
    } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/users");
  });

  it.each([
    ["USERNAME_IS_ALREADY_TAKEN", "usernameTaken"],
    ["USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "emailTaken"],
  ])("returns a translatable duplicate error for %s", async (code, expected) => {
    mocks.createUser.mockRejectedValue(new APIError("BAD_REQUEST", { code, message: "Already exists" }));
    expect(await createPlatformUser(input)).toEqual({ error: expected });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
