import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession }));

import { POST } from "./route";

describe("POST /api/wiki/spellcheck", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ user: { id: "user" } });
    vi.restoreAllMocks();
  });

  it("rejects malformed requests before contacting LanguageTool", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: [42] }),
    }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies authenticated paragraphs to the internal server", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ matches: [{ offset: 0, length: 3, message: "Typo", replacements: [{ value: "The" }] }] }), { status: 200 }));
    const response = await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: ["Teh text"] }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ matches: [{ paragraph: 0, offset: 0, length: 3, message: "Typo", replacements: ["The"] }] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
