import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/modules/wiki/presentation-actions", () => ({ acquirePresentationEditLease: vi.fn(), heartbeatPresentationEditLease: vi.fn(), releasePresentationEditLease: vi.fn() }));
import { getSession } from "@/lib/auth";
import { acquirePresentationEditLease, heartbeatPresentationEditLease, releasePresentationEditLease } from "@/modules/wiki/presentation-actions";
import { POST } from "./route";

const params = Promise.resolve({ id: "deck" });
const request = (data: unknown = { sessionId: "editor-session" }, headers: Record<string, string> = {}) => new Request("http://localhost/api/wiki/presentations/deck/lease", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "author" } } as Awaited<ReturnType<typeof getSession>>);
  vi.mocked(releasePresentationEditLease).mockResolvedValue({ released: true });
  vi.mocked(acquirePresentationEditLease).mockResolvedValue({ editable: true, expiresAt: 123 });
  vi.mocked(heartbeatPresentationEditLease).mockResolvedValue({ editable: true });
});

it("requires authentication and rejects cross-site requests", async () => {
  vi.mocked(getSession).mockResolvedValueOnce(null);
  expect((await POST(request(), { params })).status).toBe(401);
  expect((await POST(request({}, { "Sec-Fetch-Site": "cross-site" }), { params })).status).toBe(403);
  expect(releasePresentationEditLease).not.toHaveBeenCalled();
});

it("requires a JSON request with a valid session", async () => {
  expect((await POST(request({}, { "Content-Type": "text/plain" }), { params })).status).toBe(415);
  expect((await POST(request({}), { params })).status).toBe(400);
  expect(releasePresentationEditLease).not.toHaveBeenCalled();
});

it("uses the route's presentation and delegates to the ownership-checked actions", async () => {
  expect((await POST(request({ id: "other", sessionId: "editor-session" }), { params })).status).toBe(200);
  expect(releasePresentationEditLease).toHaveBeenCalledWith({ id: "deck", sessionId: "editor-session" });
  expect((await POST(request({ action: "takeover", sessionId: "editor-session" }), { params })).status).toBe(200);
  expect(acquirePresentationEditLease).toHaveBeenCalledWith({ id: "deck", sessionId: "editor-session", takeover: true });
  expect((await POST(request({ action: "heartbeat", sessionId: "editor-session" }), { params })).status).toBe(200);
  expect(heartbeatPresentationEditLease).toHaveBeenCalledWith({ id: "deck", sessionId: "editor-session" });
});
