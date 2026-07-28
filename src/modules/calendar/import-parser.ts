export type CalendarImportSuggestion = {
  title?: string;
  description?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  allDay?: boolean;
  repeat?: "none" | "daily" | "weekly" | "monthly";
};

function cleanText(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function isoDate(year: string, month: string, day: string) {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseDateTimeValue(
  value: string,
  parameters = "",
): CalendarImportSuggestion {
  const trimmed = value.trim();
  const timezone = parameters.match(/(?:^|;)TZID=([^;:]+)/i)?.[1];
  const dateOnly = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    return {
      startDate: isoDate(dateOnly[1], dateOnly[2], dateOnly[3]),
      allDay: true,
      ...(timezone ? { timezone } : {}),
    };
  }

  const dateTime = trimmed.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:\d{2})?(Z)?$/,
  );
  if (!dateTime) return {};
  return {
    startDate: isoDate(dateTime[1], dateTime[2], dateTime[3]),
    startTime: `${dateTime[4]}:${dateTime[5]}`,
    allDay: false,
    timezone: dateTime[6] ? "UTC" : timezone,
  };
}

function parseIcs(text: string): CalendarImportSuggestion | null {
  if (!/BEGIN:VEVENT/i.test(text)) return null;
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const values = new Map<string, { parameters: string; value: string }>();
  for (const line of unfolded.split(/\r?\n/)) {
    const match = line.match(/^([A-Z-]+)((?:;[^:]+)?):(.*)$/i);
    if (!match) continue;
    const key = match[1].toUpperCase();
    if (!values.has(key)) {
      values.set(key, { parameters: match[2] ?? "", value: match[3] });
    }
  }

  const startRow = values.get("DTSTART");
  const endRow = values.get("DTEND");
  const start = startRow
    ? parseDateTimeValue(startRow.value, startRow.parameters)
    : {};
  const end = endRow
    ? parseDateTimeValue(endRow.value, endRow.parameters)
    : {};
  const recurrence = values.get("RRULE")?.value.toUpperCase() ?? "";
  return {
    title: values.get("SUMMARY")
      ? cleanText(values.get("SUMMARY")!.value)
      : undefined,
    description: values.get("DESCRIPTION")
      ? cleanText(values.get("DESCRIPTION")!.value)
      : undefined,
    location: values.get("LOCATION")
      ? cleanText(values.get("LOCATION")!.value)
      : undefined,
    ...start,
    endDate: end.startDate,
    endTime: end.startTime,
    timezone: start.timezone ?? end.timezone,
    repeat: recurrence.includes("FREQ=DAILY")
      ? "daily"
      : recurrence.includes("FREQ=WEEKLY")
        ? "weekly"
        : recurrence.includes("FREQ=MONTHLY")
          ? "monthly"
          : "none",
  };
}

function parseLooseText(text: string): CalendarImportSuggestion {
  const normalized = text.replace(/\r/g, "").trim();
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const iso = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const german = normalized.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  const timeRange = normalized.match(
    /\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*(?:–|-|bis|to)\s*([01]?\d|2[0-3])[:.]([0-5]\d))\b/i,
  );
  const singleTime = normalized.match(
    /\b(?:um|at)?\s*([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:Uhr)?\b/i,
  );
  const location = normalized.match(
    /(?:^|\n)\s*(?:Ort|Location|Raum|Room)\s*:\s*([^\n]+)/i,
  );
  const description = normalized.match(
    /(?:^|\n)\s*(?:Beschreibung|Description)\s*:\s*([\s\S]+)/i,
  );
  const firstLine = lines[0];
  const title =
    firstLine &&
    firstLine.length <= 160 &&
    !/^(?:https?:\/\/|BEGIN:|DTSTART|SUMMARY|Ort:|Location:)/i.test(firstLine)
      ? firstLine
      : undefined;
  const startDate = iso
    ? isoDate(iso[1], iso[2], iso[3])
    : german
      ? isoDate(german[3], german[2], german[1])
      : undefined;
  const startTime = timeRange
    ? `${timeRange[1].padStart(2, "0")}:${timeRange[2]}`
    : singleTime
      ? `${singleTime[1].padStart(2, "0")}:${singleTime[2]}`
      : undefined;
  const endTime = timeRange?.[3] && timeRange?.[4]
    ? `${timeRange[3].padStart(2, "0")}:${timeRange[4]}`
    : undefined;

  return {
    title,
    startDate,
    startTime,
    endTime,
    location: location?.[1]?.trim(),
    description: description?.[1]?.trim().slice(0, 10_000),
  };
}

function fromIsoDateTime(value: unknown): CalendarImportSuggestion {
  if (typeof value !== "string") return {};
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/,
  );
  if (!match) return {};
  return {
    startDate: isoDate(match[1], match[2], match[3]),
    ...(match[4] ? { startTime: `${match[4]}:${match[5]}` } : { allDay: true }),
  } satisfies CalendarImportSuggestion;
}

function findJsonLdEvent(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findJsonLdEvent(entry);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (
    type === "Event" ||
    (Array.isArray(type) && type.some((entry) => entry === "Event"))
  ) {
    return record;
  }
  return findJsonLdEvent(record["@graph"]);
}

export function parseCalendarImport(
  text: string,
  options: {
    titleHint?: string;
    jsonLd?: unknown[];
    sourceUrl?: string;
  } = {},
): CalendarImportSuggestion {
  const ics = parseIcs(text);
  if (ics) return ics;

  for (const value of options.jsonLd ?? []) {
    const event = findJsonLdEvent(value);
    if (!event) continue;
    const start = fromIsoDateTime(event.startDate);
    const end = fromIsoDateTime(event.endDate);
    const location =
      typeof event.location === "string"
        ? event.location
        : event.location &&
            typeof event.location === "object" &&
            typeof (event.location as Record<string, unknown>).name === "string"
          ? String((event.location as Record<string, unknown>).name)
          : undefined;
    return {
      title: typeof event.name === "string" ? event.name.trim() : options.titleHint,
      description:
        typeof event.description === "string"
          ? event.description.trim().slice(0, 10_000)
          : undefined,
      location,
      ...start,
      endDate: end.startDate,
      endTime: end.startTime,
    };
  }

  const loose = parseLooseText(text);
  return {
    ...loose,
    title: loose.title ?? options.titleHint?.trim(),
    location:
      loose.location ??
      (options.sourceUrl &&
      /(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com)/i.test(
        options.sourceUrl,
      )
        ? options.sourceUrl
        : undefined),
  };
}
