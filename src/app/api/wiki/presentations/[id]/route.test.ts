import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/modules/wiki/presentation-actions", () => ({ savePresentation: vi.fn() }));

import { getSession } from "@/lib/auth";
import { savePresentation } from "@/modules/wiki/presentation-actions";
import { PATCH } from "./route";

const params = Promise.resolve({ id: "presentation" });
const data = { elements: [], steps: [], sessionId: "test-session", expectedUpdatedAt: 123 };
const request = (body: unknown = data, headers: Record<string, string> = {}) => new Request("http://localhost/api/wiki/presentations/presentation", {
  method: "PATCH", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ user: { id: "author" } } as Awaited<ReturnType<typeof getSession>>);
  vi.mocked(savePresentation).mockResolvedValue({ locked: false, conflict: false, savedAt: 124 });
});

it("requires authentication and rejects cross-site requests", async () => {
  vi.mocked(getSession).mockResolvedValueOnce(null);
  expect((await PATCH(request(), { params })).status).toBe(401);
  expect((await PATCH(request(data, { "Sec-Fetch-Site": "cross-site" }), { params })).status).toBe(403);
  expect(savePresentation).not.toHaveBeenCalled();
});

it("requires a JSON draft with its editing session and expected version", async () => {
  expect((await PATCH(request(data, { "Content-Type": "text/plain" }), { params })).status).toBe(415);
  expect((await PATCH(request({ elements: [], steps: [] }), { params })).status).toBe(400);
  expect(savePresentation).not.toHaveBeenCalled();
});

it("saves through the same validated action and uses the id in the route", async () => {
  const response = await PATCH(request({ ...data, id: "different" }), { params });
  expect(response.status).toBe(200);
  expect(savePresentation).toHaveBeenCalledWith({ ...data, id: "presentation" });
});

it("reports a stale version as a conflict", async () => {
  vi.mocked(savePresentation).mockResolvedValueOnce({ locked: false, conflict: true });
  expect((await PATCH(request(), { params })).status).toBe(409);
});
