import { describe, expect, it } from "vitest";
import { normalizePerformanceRoute } from "./performance";

describe("normalizePerformanceRoute", () => {
  it("removes query strings and dynamic identifiers", () => {
    expect(
      normalizePerformanceRoute(
        "/wiki/sources/v3a9n0z4f7q2m8p6t1kc/read/12345678901234567890?page=4",
      ),
    ).toBe("/wiki/sources/[id]/read/[id]");
  });

  it("keeps stable route names", () => {
    expect(normalizePerformanceRoute("/accounting/bookings")).toBe(
      "/accounting/bookings",
    );
  });
});
