import { describe, expect, it } from "vitest";
import { isValidIsoDate, toLocalIsoDate } from "./date";

describe("toLocalIsoDate", () => {
  it("uses the Austrian day after UTC midnight boundaries", () => {
    expect(toLocalIsoDate(new Date("2026-07-07T22:30:00Z"))).toBe("2026-07-08");
    expect(toLocalIsoDate(new Date("2026-01-07T23:30:00Z"))).toBe("2026-01-08");
  });
});

describe("isValidIsoDate", () => {
  it("accepts real calendar dates and rejects rollovers", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
  });
});
