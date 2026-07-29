import { describe, expect, it } from "vitest";
import {
  addDays,
  dateAndMinutesInZone,
  dateRange,
  daysBetween,
  isValidDate,
  overlapsDateRange,
  startOfWeek,
} from "./date-utils";

describe("calendar date utilities", () => {
  it("rejects impossible ISO calendar dates", () => {
    expect(isValidDate("2026-07-28")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-99-99")).toBe(false);
  });

  it("projects an instant into the configured calendar timezone", () => {
    const instant = new Date("2026-07-28T22:30:00.000Z");
    expect(dateAndMinutesInZone(instant, "Europe/Vienna")).toEqual({
      date: "2026-07-29",
      minutes: 30,
    });
    expect(dateAndMinutesInZone(instant, "America/Los_Angeles")).toEqual({
      date: "2026-07-28",
      minutes: 15 * 60 + 30,
    });
  });
  it("uses end-exclusive ranges across month and leap-year boundaries", () => {
    expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(dateRange("2028-02-28", "2028-03-02")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("builds Monday-first weeks without depending on the host timezone", () => {
    expect(startOfWeek("2026-07-27", 1)).toBe("2026-07-27");
    expect(startOfWeek("2026-08-02", 1)).toBe("2026-07-27");
  });

  it("treats touching ranges as non-overlapping", () => {
    expect(
      overlapsDateRange(
        "2026-07-27",
        "2026-07-28",
        "2026-07-28",
        "2026-07-29",
      ),
    ).toBe(false);
    expect(
      overlapsDateRange(
        "2026-07-27",
        "2026-07-29",
        "2026-07-28",
        "2026-07-30",
      ),
    ).toBe(true);
  });
});
