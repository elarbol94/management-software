import { describe, expect, it } from "vitest";
import { parseCalendarImport } from "./import-parser";

describe("parseCalendarImport", () => {
  it("extracts explicit event fields from ICS", () => {
    const result = parseCalendarImport(`BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Projektauftakt
DTSTART;TZID=Europe/Berlin:20260804T093000
DTEND;TZID=Europe/Berlin:20260804T110000
LOCATION:Raum Atlas
DESCRIPTION:Kick-off mit dem Projektteam
RRULE:FREQ=WEEKLY
END:VEVENT
END:VCALENDAR`);

    expect(result).toMatchObject({
      title: "Projektauftakt",
      startDate: "2026-08-04",
      startTime: "09:30",
      endTime: "11:00",
      timezone: "Europe/Berlin",
      location: "Raum Atlas",
      description: "Kick-off mit dem Projektteam",
      repeat: "weekly",
      allDay: false,
    });
  });

  it("recognizes clear German date, time range and location labels", () => {
    const result = parseCalendarImport(`Werkstattgespräch
04.08.2026, 14:15–16:00 Uhr
Ort: Labor 2`);

    expect(result).toMatchObject({
      title: "Werkstattgespräch",
      startDate: "2026-08-04",
      startTime: "14:15",
      endTime: "16:00",
      location: "Labor 2",
    });
  });

  it("prefers structured Event metadata from linked pages", () => {
    const result = parseCalendarImport("Fallback page text", {
      titleHint: "Fallback title",
      jsonLd: [
        {
          "@type": "Event",
          name: "Team review",
          startDate: "2026-08-10T10:00:00+02:00",
          endDate: "2026-08-10T11:30:00+02:00",
          location: { "@type": "Place", name: "Studio" },
        },
      ],
    });

    expect(result).toMatchObject({
      title: "Team review",
      startDate: "2026-08-10",
      startTime: "10:00",
      endTime: "11:30",
      location: "Studio",
    });
  });
});
