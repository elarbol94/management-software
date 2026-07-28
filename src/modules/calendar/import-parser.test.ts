import { describe, expect, it } from "vitest";
import {
  normalizeCalendarUrl,
  parseCalendarImport,
} from "./import-parser";

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

  it("reads labelled fields from the Social Business Hub event page", () => {
    const result = parseCalendarImport(
      `10 Nov 2026
Social Business Meet & Greet 2026 – Wir feiern das Unternehmertum der Zukunft
Beginn:
10.11.2026, 19:00 Uhr
Veranstaltungsort:
UNICORN Startup & Innovation Hub Graz, 4. Stock, Conference Deck
Adresse:
Schubertstraße 6a, 8010 Graz`,
      {
        titleHint:
          "Social Business Meet & Greet 2026 – Wir feiern das Unternehmertum der Zukunft",
      },
    );

    expect(result).toMatchObject({
      startDate: "2026-11-10",
      startTime: "19:00",
      endTime: "20:00",
      location:
        "UNICORN Startup & Innovation Hub Graz, 4. Stock, Conference Deck",
      address: "Schubertstraße 6a, 8010 Graz",
    });
    expect(result.location).not.toContain("Schubertstraße");
  });

  it("keeps JSON-LD venue and postal address in separate fields", () => {
    const result = parseCalendarImport("", {
      jsonLd: [
        {
          "@type": "Event",
          name: "Founder breakfast",
          startDate: "2026-09-02T08:00:00+02:00",
          location: {
            "@type": "Place",
            name: "Innovation Hall",
            address: {
              "@type": "PostalAddress",
              streetAddress: "Hauptplatz 1",
              postalCode: "8010",
              addressLocality: "Graz",
              addressCountry: "AT",
            },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      location: "Innovation Hall",
      address: "Hauptplatz 1, 8010, Graz, AT",
    });
  });

  it("fills missing JSON-LD fields from visible labelled text", () => {
    const result = parseCalendarImport(
      `Beginn: 10.11.2026, 19:00 Uhr
Veranstaltungsort: UNICORN Conference Deck`,
      {
        targetTimezone: "Europe/Berlin",
        jsonLd: [
          {
            "@type": "Event",
            name: "Meet & Greet",
            startDate: "2026-11-10T18:00:00Z",
          },
        ],
      },
    );

    expect(result).toMatchObject({
      title: "Meet & Greet",
      startDate: "2026-11-10",
      startTime: "19:00",
      endTime: "20:00",
      location: "UNICORN Conference Deck",
    });
  });

  it("converts offset timestamps to the selected IANA timezone", () => {
    const result = parseCalendarImport("", {
      targetTimezone: "Europe/Berlin",
      jsonLd: [
        {
          "@type": "Event",
          startDate: "2026-11-10T18:00:00Z",
          endDate: "2026-11-10T20:30:00+00:00",
        },
      ],
    });

    expect(result).toMatchObject({
      startDate: "2026-11-10",
      startTime: "19:00",
      endTime: "21:30",
      timezone: "Europe/Berlin",
    });
  });

  it("uses a 60 minute default and handles midnight", () => {
    expect(
      parseCalendarImport("Beginn: 04.08.2026, 23:30 Uhr"),
    ).toMatchObject({
      startTime: "23:30",
      endTime: "00:30",
    });
    expect(
      parseCalendarImport(
        "Beginn: 04.08.2026, 19:00 Uhr\nEnde: 04.08.2026, 21:15 Uhr",
      ),
    ).toMatchObject({
      startTime: "19:00",
      endTime: "21:15",
    });
  });
});

describe("normalizeCalendarUrl", () => {
  it.each([
    [
      "socialbusinesshub.at/events/social-business-meet-greet-2026/",
      "https://socialbusinesshub.at/events/social-business-meet-greet-2026/",
    ],
    ["www.example.org/event", "https://www.example.org/event"],
    ["https://example.org/event", "https://example.org/event"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCalendarUrl(input)).toBe(expected);
  });

  it.each(["", "kein-link", "mailto:test@example.org", "file:///tmp/test"])(
    "rejects %s",
    (input) => {
      expect(() => normalizeCalendarUrl(input)).toThrow("invalid_url");
    },
  );
});
