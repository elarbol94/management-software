import { describe, expect, it } from "vitest";
import {
  formatAustrianDate,
  parseAustrianDate,
  parseAustrianTime,
} from "./localized-date-time";

describe("Austrian calendar fields", () => {
  it("formats and parses dates without depending on browser locale", () => {
    expect(formatAustrianDate("2026-11-10")).toBe("10.11.2026");
    expect(parseAustrianDate("10.11.2026")).toBe("2026-11-10");
  });

  it("rejects malformed and impossible dates", () => {
    expect(parseAustrianDate("11/10/2026")).toBeNull();
    expect(parseAustrianDate("31.02.2026")).toBeNull();
  });

  it("normalizes valid 24-hour times and rejects AM/PM-style values", () => {
    expect(parseAustrianTime("7:05")).toBe("07:05");
    expect(parseAustrianTime("19:00")).toBe("19:00");
    expect(parseAustrianTime("24:00")).toBeNull();
    expect(parseAustrianTime("07:00 PM")).toBeNull();
  });
});
