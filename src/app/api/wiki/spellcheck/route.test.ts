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

  it("requires a supported proofing language", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: ["Text"], language: "fr-FR" }),
    }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies authenticated paragraphs and normalizes spelling and writing issues", async () => {
    const replacements = Array.from({ length: 7 }, (_, index) => ({ value: "word-" + index }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ matches: [
      { offset: 0, length: 3, message: "Typo", rule: { id: "TYPOS_RULE", issueType: "misspelling", category: { id: "TYPOS", name: "Possible typos" } }, replacements },
      { offset: 4, length: 4, message: "Agreement", rule: { id: "GRAMMAR_RULE", issueType: "grammar", category: { id: "GRAMMAR", name: "Grammar" } }, replacements: [{ value: "runs" }] },
    ] }), { status: 200 }));
    const response = await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: ["Teh runs"], language: "en-US" }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ matches: [
      { paragraph: 0, offset: 0, length: 3, message: "Typo", kind: "spelling", category: "Possible typos", ruleId: "TYPOS_RULE", replacements: replacements.map((item) => item.value) },
      { paragraph: 0, offset: 4, length: 4, message: "Agreement", kind: "writing", category: "Grammar", ruleId: "GRAMMAR_RULE", replacements: ["runs"] },
    ] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestBody = fetchMock.mock.calls[0][1]?.body;
    expect(requestBody).toBeInstanceOf(URLSearchParams);
    expect((requestBody as URLSearchParams).get("language")).toBe("en-US");
    expect((requestBody as URLSearchParams).get("enabledOnly")).toBe("false");
  });

  it("checks multiple paragraphs in one LanguageTool request and remaps offsets", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ matches: [
      { offset: 0, length: 3, message: "Typo", rule: { issueType: "misspelling" }, replacements: [{ value: "The" }] },
      { offset: 13, length: 4, message: "Grammar", rule: { issueType: "grammar" }, replacements: [{ value: "car" }] },
      { offset: 7, length: 2, message: "Separator", rule: { issueType: "typographical" }, replacements: [] },
    ] }), { status: 200 }));
    const response = await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: ["Teh run", "Die Auto"], language: "en-US" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ matches: [
      { paragraph: 0, offset: 0, length: 3, message: "Typo", kind: "spelling", category: "", ruleId: "", replacements: ["The"] },
      { paragraph: 1, offset: 4, length: 4, message: "Grammar", kind: "writing", category: "", ruleId: "", replacements: ["car"] },
    ] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0][1]?.body as URLSearchParams).get("text")).toBe("Teh run\n\nDie Auto");
  });

  it("filters shared dictionary words", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ matches: [
      { offset: 0, length: 7, message: "Unknown word", rule: { id: "SPELL", issueType: "misspelling" }, replacements: [] },
    ] }), { status: 200 }));
    const response = await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: ["Brandzz"], language: "de-DE", dictionary: ["Brandzz"] }),
    }));
    await expect(response.json()).resolves.toEqual({ matches: [] });
  });

  it("reuses identical server results", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ matches: [] }), { status: 200 }));
    const body = JSON.stringify({ paragraphs: ["Cachezz sentence"], language: "en-US" });
    await POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", headers: { "content-type": "application/json" }, body }));
    await POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
