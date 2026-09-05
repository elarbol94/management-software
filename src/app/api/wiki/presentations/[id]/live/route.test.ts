import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/modules/wiki/presentation-live-actions", () => ({
  startPresentationLiveSession: vi.fn(), publishPresentationLivePosition: vi.fn(), stopPresentationLiveSession: vi.fn(),
}));
import { getSession } from "@/lib/auth";
import { publishPresentationLivePosition, startPresentationLiveSession, stopPresentationLiveSession } from "@/modules/wiki/presentation-live-actions";
import { POST } from "./route";

const params = Promise.resolve({ id: "deck" });
const request = (data: unknown = { action: "start" }, headers: Record<string, string> = {}) => new Request("http://localhost/api/wiki/presentations/deck/live", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "author" } } as Awaited<ReturnType<typeof getSession>>);
  vi.mocked(startPresentationLiveSession).mockResolvedValue({ code: "ABC234" });
  vi.mocked(publishPresentationLivePosition).mockResolvedValue({ live: true });
  vi.mocked(stopPresentationLiveSession).mockResolvedValue({ stopped: true });
});

it("requires authentication and same-origin JSON requests", async () => {
  vi.mocked(getSession).mockResolvedValueOnce(null);
  expect((await POST(request(), { params })).status).toBe(401);
  expect((await POST(request({}, { "Sec-Fetch-Site": "cross-site" }), { params })).status).toBe(403);
  expect((await POST(request({}, { "Content-Type": "text/plain" }), { params })).status).toBe(415);
  expect(startPresentationLiveSession).not.toHaveBeenCalled();
});

it("requires a matching session code for publish and stop commands", async () => {
  expect((await POST(request({ action: "stop" }), { params })).status).toBe(400);
  expect((await POST(request({ action: "publish", code: "bad", stepIndex: 1 }), { params })).status).toBe(400);
  expect(stopPresentationLiveSession).not.toHaveBeenCalled();
  expect(publishPresentationLivePosition).not.toHaveBeenCalled();
});

it("delegates commands to the ownership-checked actions with the route's presentation id", async () => {
  expect((await POST(request({ action: "start", presentationId: "other" }), { params })).status).toBe(200);
  expect(startPresentationLiveSession).toHaveBeenCalledWith({ presentationId: "deck", stepIndex: 0 });
  expect((await POST(request({ action: "publish", code: "ABC234", stepIndex: 2 }), { params })).status).toBe(200);
  expect(publishPresentationLivePosition).toHaveBeenCalledWith({ presentationId: "deck", code: "ABC234", stepIndex: 2 });
  expect((await POST(request({ action: "stop", code: "ABC234" }), { params })).status).toBe(200);
  expect(stopPresentationLiveSession).toHaveBeenCalledWith({ presentationId: "deck", code: "ABC234" });
});
