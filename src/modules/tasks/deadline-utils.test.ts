import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareDeadlineTiming,
  deadlineDayState,
  isDeadlineOverdue,
  localDateValue,
  localDeadlineToUtc,
  todayLocal,
} from "./deadline-utils";

describe("deadline timing", () => {
  const originalTimeZone = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "Europe/Berlin";
  });

  afterEach(() => {
    process.env.TZ = originalTimeZone;
  });

  it("keeps date-only deadlines open through their local calendar day", () => {
    const now = new Date("2026-07-28T21:59:00+02:00");
    expect(isDeadlineOverdue({
      deadlineDate: "2026-07-28",
      deadlineAt: null,
      status: "open",
    }, now)).toBe(false);
    expect(deadlineDayState({
      deadlineDate: "2026-07-28",
      deadlineAt: null,
      status: "open",
    }, now)).toBe("today");
  });

  it("formats the browser-local calendar date without converting to UTC", () => {
    expect(todayLocal(new Date(2026, 6, 29, 0, 30))).toBe("2026-07-29");
  });

  it("rejects calendar dates that roll into another month", () => {
    expect(localDateValue("2026-02-29")).toBeNull();
    expect(localDateValue("2026-02-28")).toBeInstanceOf(Date);
  });

  it("uses the exact timestamp when a time is present", () => {
    const now = new Date("2026-07-28T10:31:00+02:00");
    expect(isDeadlineOverdue({
      deadlineDate: "2026-07-28",
      deadlineAt: "2026-07-28T08:30:00.000Z",
      status: "open",
    }, now)).toBe(true);
  });

  it("converts browser-local summer and winter times to UTC", () => {
    expect(localDeadlineToUtc("2026-07-28", "10:30")).toBe("2026-07-28T08:30:00.000Z");
    expect(localDeadlineToUtc("2026-01-28", "10:30")).toBe("2026-01-28T09:30:00.000Z");
  });

  it("sorts all-day deadlines before timed deadlines on the same day", () => {
    const values = [
      { deadlineDate: "2026-07-28", deadlineAt: "2026-07-28T08:30:00.000Z" },
      { deadlineDate: "2026-07-28", deadlineAt: null },
      { deadlineDate: "2026-07-27", deadlineAt: null },
    ].sort(compareDeadlineTiming);
    expect(values.map((value) => value.deadlineAt)).toEqual([
      null,
      null,
      "2026-07-28T08:30:00.000Z",
    ]);
  });
});
