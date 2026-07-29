import { beforeEach, describe, expect, it, vi } from "vitest";

const { dnsLookup, getSession } = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession }));
vi.mock("node:dns/promises", () => ({
  default: { lookup: dnsLookup },
}));

import { POST } from "./route";

describe("POST /api/wiki/metadata", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: "user" } });
    dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it("rejects malformed JSON without attempting a remote lookup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("http://test/api/wiki/metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "unknown", value: "10.1000/example" },
    { kind: "doi", value: "" },
    { kind: "doi" },
    { kind: "doi", value: "10.1000/example", accessedAt: "2026-02-30" },
    null,
  ])("rejects unsupported lookup input %#", async (body) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("http://test/api/wiki/metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid metadata lookup",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    getSession.mockResolvedValue(null);
    const response = await POST(
      new Request("http://test/api/wiki/metadata", {
        method: "POST",
        body: JSON.stringify({ kind: "doi", value: "10.1000/example" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it.each([
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::c0a8:101",
    "::192.168.1.1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "::",
  ])(
    "rejects non-public IPv6 resolution %s",
    async (address) => {
      dnsLookup.mockResolvedValue([{ address, family: 6 }]);
      const fetchMock = vi.spyOn(globalThis, "fetch");
      const response = await POST(
        new Request("http://test/api/wiki/metadata", {
          method: "POST",
          body: JSON.stringify({ kind: "url", value: "https://example.com" }),
        }),
      );
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
