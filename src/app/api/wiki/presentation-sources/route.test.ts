import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/modules/wiki/presentation-source-queries", () => ({ presentationSourcePreviews: vi.fn(() => []), documentPresentationLinks: vi.fn(), getPresentationSourceDocument: vi.fn(), listPresentationSourceDocuments: vi.fn() }));
import { getSession } from "@/lib/auth";
import { presentationSourcePreviews } from "@/modules/wiki/presentation-source-queries";
import { POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/wiki/presentation-sources", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getSession).mockResolvedValue({ user: { id: "user" } } as Awaited<ReturnType<typeof getSession>>); });
describe("source preview API", () => {
  it("requires authentication before querying document text", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(request({ sources: [] }))).status).toBe(401);
    expect(presentationSourcePreviews).not.toHaveBeenCalled();
  });
  it("rejects invalid and oversized batches and malformed JSON", async () => {
    for (const body of [{ sources: [{ pageId: "", sectionId: "a" }] }, { sources: [{ pageId: "page", sectionId: "a".repeat(201) }] }, { sources: Array.from({ length: 501 }, () => ({ pageId: "page", sectionId: "" })) }]) expect((await POST(request(body))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/wiki/presentation-sources", { method: "POST", body: "{" }))).status).toBe(400);
    expect(presentationSourcePreviews).not.toHaveBeenCalled();
  });
  it("returns private uncached previews for validated local references", async () => {
    const sources = [{ pageId: "page", sectionId: "" }];
    const response = await POST(request({ sources }));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(presentationSourcePreviews).toHaveBeenCalledWith(sources);
  });
});
