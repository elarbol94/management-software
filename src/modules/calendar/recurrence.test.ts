import { describe, expect, it } from "vitest";
import { expandEventOccurrences, validateRecurrenceRule } from "./recurrence";

describe("calendar recurrence", () => {
  it("keeps a weekly Berlin event at the same wall-clock time across DST", () => {
    const occurrences = expandEventOccurrences(
      {
        id: "weekly",
        title: "Operations review",
        description: "",
        allDay: false,
        startDate: null,
        endDate: null,
        startAt: new Date("2026-03-23T08:00:00.000Z"),
        endAt: new Date("2026-03-23T09:00:00.000Z"),
        timezone: "Europe/Berlin",
        recurrenceRule: "FREQ=WEEKLY;COUNT=3",
      },
      [],
      new Date("2026-03-20T00:00:00.000Z"),
      new Date("2026-04-10T00:00:00.000Z"),
    );

    expect(occurrences.map((item) => item.startAt?.toISOString())).toEqual([
      "2026-03-23T08:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
      "2026-04-06T07:00:00.000Z",
    ]);
  });

  it("applies all-day recurrence exceptions by occurrence key", () => {
    const occurrences = expandEventOccurrences(
      {
        id: "monthly",
        title: "Close books",
        description: "",
        allDay: true,
        startDate: "2026-07-01",
        endDate: "2026-07-02",
        startAt: null,
        endAt: null,
        timezone: "Europe/Berlin",
        recurrenceRule: "FREQ=DAILY;COUNT=3",
      },
      [
        {
          occurrenceKey: "2026-07-02",
          cancelled: true,
          overrideJson: "{}",
        },
        {
          occurrenceKey: "2026-07-03",
          cancelled: false,
          overrideJson: JSON.stringify({ title: "Close and report" }),
        },
      ],
      new Date("2026-07-01T00:00:00.000Z"),
      new Date("2026-07-05T00:00:00.000Z"),
    );

    expect(occurrences.map((item) => [item.startDate, item.title])).toEqual([
      ["2026-07-01", "Close books"],
      ["2026-07-03", "Close and report"],
    ]);
  });

  it("rejects recurrence strings without a frequency", () => {
    expect(() => validateRecurrenceRule("COUNT=3")).toThrow(
      "Invalid recurrence rule",
    );
  });
});

