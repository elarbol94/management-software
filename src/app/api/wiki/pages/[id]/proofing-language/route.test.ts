import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, updatePageProofingLanguage } = vi.hoisted(() => ({ getSession: vi.fn(), updatePageProofingLanguage: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession }));
vi.mock("@/modules/wiki/actions", () => ({ updatePageProofingLanguage }));

import { PATCH } from "./route";

describe("PATCH /api/wiki/pages/[id]/proofing-language", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "user" } });
    updatePageProofingLanguage.mockResolvedValue({ proofingLanguage: "en-US" });
  });

  it("persists the selected page language through a stable route", async () => {
    const response = await PATCH(new Request("http://test/api/wiki/pages/page-1/proofing-language", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "en-US" }),
    }), { params: Promise.resolve({ id: "page-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ proofingLanguage: "en-US" });
    expect(updatePageProofingLanguage).toHaveBeenCalledWith({ pageId: "page-1", language: "en-US" });
  });

  it("persists de-AT as a selectable page language", async () => {
    updatePageProofingLanguage.mockResolvedValue({ proofingLanguage: "de-AT" });
    const response = await PATCH(new Request("http://test/api/wiki/pages/page-1/proofing-language", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "de-AT" }),
    }), { params: Promise.resolve({ id: "page-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ proofingLanguage: "de-AT" });
    expect(updatePageProofingLanguage).toHaveBeenCalledWith({ pageId: "page-1", language: "de-AT" });
  });
});
