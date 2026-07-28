import { describe, expect, it } from "vitest";
import {
  addDays,
  dateRange,
  daysBetween,
  overlapsDateRange,
  startOfWeek,
} from "./date-utils";

describe("calendar date utilities", () => {
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

