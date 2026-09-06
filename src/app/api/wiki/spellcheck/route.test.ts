import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession }));

import { POST } from "./route";

describe("POST /api/wiki/spellcheck", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ user: { id: "user" } });
    vi.restoreAllMocks();
  });

  it("reports service and cache timings without including document text", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ matches: [] }));
    const makeRequest = () => new Request("http://test/api/wiki/spellcheck", { method: "POST", body: JSON.stringify({ paragraphs: ["Private timing sample"], language: "en-US" }) });
    const first = await POST(makeRequest());
    const cached = await POST(makeRequest());
    expect(first.headers.get("server-timing")).toMatch(/cache;desc="miss".*languagetool;dur=[\d.]+.*normalize;dur=[\d.]+.*total;dur=[\d.]+/);
    expect(cached.headers.get("server-timing")).toContain('cache;desc="hit"');
    expect(first.headers.get("server-timing")).not.toContain("Private");
    expect(cached.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels obsolete service work and permits a fresh request for the same text", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    const abort = new AbortController();
    const body = JSON.stringify({ paragraphs: ["Obsolete request sample"], language: "en-US" });
    const response = POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", body, signal: abort.signal }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const serviceSignal = fetchMock.mock.calls[0][1]!.signal!;
    abort.abort();
    expect((await response).status).toBe(499);
    expect(serviceSignal.aborted).toBe(true);
    fetchMock.mockResolvedValue(Response.json({ matches: [] }));
    expect((await POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", body }))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a shared service request alive until its remaining editor receives the result", async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const abort = new AbortController();
    const body = JSON.stringify({ paragraphs: ["Two editors sharing a request"], language: "en-US" });
    const first = POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", body, signal: abort.signal }));
    const second = POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", body }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetchMock).toHaveBeenCalledOnce();
    abort.abort();
    expect((await first).status).toBe(499);
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
    release(Response.json({ matches: [] }));
    const response = await second;
    expect(response.status).toBe(200);
    expect(response.headers.get("server-timing")).toMatch(/cache;desc="shared".*shared_wait;dur=/);
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

  it("accepts de-AT as a supported proofing language", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ matches: [] }), { status: 200 }));
    const response = await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: ["Text"], language: "de-AT" }),
    }));
    expect(response.status).toBe(200);
    expect((fetchMock.mock.calls[0][1]?.body as URLSearchParams).get("language")).toBe("de-AT");
  });

  it("rejects a non-boolean picky flag", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: ["Text"], language: "en-US", picky: "yes" }),
    }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards picky mode as LanguageTool's level parameter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ matches: [] }), { status: 200 }));
    await POST(new Request("http://test/api/wiki/spellcheck", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paragraphs: ["Text"], language: "en-US", picky: true }),
    }));
    expect((fetchMock.mock.calls[0][1]?.body as URLSearchParams).get("level")).toBe("picky");
  });

  it("caches picky and default-level results for the same text separately", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ matches: [] }), { status: 200 }));
    const body = (picky: boolean) => JSON.stringify({ paragraphs: ["Same text"], language: "en-US", picky });
    await POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", headers: { "content-type": "application/json" }, body: body(false) }));
    await POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", headers: { "content-type": "application/json" }, body: body(true) }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("preserves deletion suggestions and grammar rules for dictionary words", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ matches: [
      { offset: 0, length: 6, message: "Repeated word", rule: { issueType: "grammar" }, replacements: [{ value: "" }, { value: "" }] },
      null, { offset: -1, length: 2, message: "Bad range" }, { offset: 0, length: 0, message: "Empty" },
    ] }));
    const response = await POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", body: JSON.stringify({ paragraphs: ["Repeat repeat"], language: "en-US", dictionary: ["Repeat"] }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).matches).toEqual([expect.objectContaining({ replacements: [""], kind: "writing" })]);
  });

  it("does not present malformed service responses as a successful check", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "warming up" }));
    const response = await POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", body: JSON.stringify({ paragraphs: ["Invalid response test"], language: "en-US" }) }));
    expect(response.status).toBe(503);
  });

  it("requires authentication before sending document text to the service", async () => {
    getSession.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await POST(new Request("http://test/api/wiki/spellcheck", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
