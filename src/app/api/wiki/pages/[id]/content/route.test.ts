import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, savePageContent } = vi.hoisted(() => ({ getSession: vi.fn(), savePageContent: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession }));
vi.mock("@/modules/wiki/actions", () => ({ savePageContent }));

import { PATCH } from "./route";

describe("PATCH /api/wiki/pages/[id]/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "user" } });
    savePageContent.mockResolvedValue({ saved: true, conflict: false, version: 4 });
  });

  it("uses the stable route id and returns the save result", async () => {
    const response = await PATCH(new Request("http://test/api/wiki/pages/page-1/content", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentJson: "{}", expectedVersion: 3 }),
    }), { params: Promise.resolve({ id: "page-1" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ saved: true, conflict: false, version: 4 });
    expect(savePageContent).toHaveBeenCalledWith({ id: "page-1", contentJson: "{}", expectedVersion: 3 });
  });

  it("rejects unauthenticated requests", async () => {
    getSession.mockResolvedValue(null);
    const response = await PATCH(new Request("http://test/api/wiki/pages/page-1/content", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: "page-1" }) });
    expect(response.status).toBe(401);
    expect(savePageContent).not.toHaveBeenCalled();
  });
});
