export type CalendarImportSuggestion = {
  title?: string;
  description?: string;
  location?: string;
  address?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  allDay?: boolean;
  repeat?: "none" | "daily" | "weekly" | "monthly";
  analysisMethod?: "ai" | "parser";
};

export function normalizeCalendarUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("invalid_url");
  const explicitScheme = trimmed.match(/^([a-z][a-z\d+.-]*):/i)?.[1];
  if (explicitScheme && !/^https?$/i.test(explicitScheme)) {
    throw new Error("invalid_url");
  }
  const candidate = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : explicitScheme
      ? trimmed
      : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("invalid_url");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    (!url.hostname.includes(".") && !url.hostname.includes(":"))
  ) {
    throw new Error("invalid_url");
  }
  return url.toString();
}

function addMinutes(time: string, minutes: number) {
  const [hour, minute] = time.split(":").map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function withDefaultEnd(suggestion: CalendarImportSuggestion) {
  if (
    suggestion.allDay !== true &&
    suggestion.startTime &&
    !suggestion.endTime
  ) {
    return { ...suggestion, endTime: addMinutes(suggestion.startTime, 60) };
  }
  return suggestion;
}

export function mergeCalendarImportSuggestions(
  primary: CalendarImportSuggestion,
  fallback: CalendarImportSuggestion,
) {
  const merged: CalendarImportSuggestion = {};
  const fields = [
    "title",
    "description",
    "location",
    "address",
    "startDate",
    "endDate",
    "startTime",
    "endTime",
    "timezone",
    "allDay",
    "repeat",
  ] as const;
  for (const field of fields) {
    const value = primary[field] ?? fallback[field];
    if (value !== undefined) Object.assign(merged, { [field]: value });
  }
  return withDefaultEnd(merged);
}

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
  return withDefaultEnd({
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
  });
}

function parseHumanDateTime(value: string): CalendarImportSuggestion {
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const german = value.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  const time =
    value.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/) ??
    value.match(/\b([01]?\d|2[0-3])\.([0-5]\d)\s*Uhr\b/i);
  return {
    startDate: iso
      ? isoDate(iso[1], iso[2], iso[3])
      : german
        ? isoDate(german[3], german[2], german[1])
        : undefined,
    startTime: time
      ? `${time[1].padStart(2, "0")}:${time[2]}`
      : undefined,
  };
}

function labelledValue(text: string, labels: string) {
  return text.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:${labels})\\s*:\\s*([^\\n]+)`,
      "i",
    ),
  )?.[1]?.trim();
}

function parseLabelledEventText(text: string): CalendarImportSuggestion {
  const normalized = text.replace(/\r/g, "").trim();
  const startValue = labelledValue(
    normalized,
    "Beginn|Start(?:zeit)?|Starts?",
  );
  const endValue = labelledValue(normalized, "Ende|End(?:zeit)?|Ends?");
  const location = labelledValue(
    normalized,
    "Veranstaltungsort|Event\\s*location|Venue|Ort|Location|Raum|Room",
  );
  const address = labelledValue(
    normalized,
    "Adresse|Address|Street\\s*address|Postanschrift",
  );
  const start = startValue ? parseHumanDateTime(startValue) : {};
  const end = endValue ? parseHumanDateTime(endValue) : {};
  return {
    startDate: start.startDate,
    startTime: start.startTime,
    endDate: end.startDate,
    endTime: end.startTime,
    location,
    address,
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
  const location = labelledValue(
    normalized,
    "Veranstaltungsort|Event\\s*location|Venue|Ort|Location|Raum|Room",
  );
  const address = labelledValue(
    normalized,
    "Adresse|Address|Street\\s*address|Postanschrift",
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
    location,
    address,
    description: description?.[1]?.trim().slice(0, 10_000),
  };
}

function zonedParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    startDate: isoDate(part("year"), part("month"), part("day")),
    startTime: `${part("hour")}:${part("minute")}`,
  };
}

function fromIsoDateTime(
  value: unknown,
  targetTimezone?: string,
): CalendarImportSuggestion {
  if (typeof value !== "string") return {};
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/,
  );
  if (!match) return {};
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (match[4] && hasOffset && targetTimezone) {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) {
      return {
        ...zonedParts(instant, targetTimezone),
        timezone: targetTimezone,
      };
    }
  }
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

function jsonLdAddress(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object") return undefined;
  const address = value as Record<string, unknown>;
  const parts = [
    address.streetAddress,
    address.postalCode,
    address.addressLocality,
    address.addressRegion,
    address.addressCountry,
  ]
    .filter(
      (part): part is string =>
        typeof part === "string" && Boolean(part.trim()),
    )
    .map((part) => part.trim());
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function parseCalendarImport(
  text: string,
  options: {
    titleHint?: string;
    jsonLd?: unknown[];
    sourceUrl?: string;
    targetTimezone?: string;
  } = {},
): CalendarImportSuggestion {
  const ics = parseIcs(text);
  if (ics) return ics;

  const labelled = parseLabelledEventText(text);
  let structured: CalendarImportSuggestion = {};
  for (const value of options.jsonLd ?? []) {
    const event = findJsonLdEvent(value);
    if (!event) continue;
    const start = fromIsoDateTime(event.startDate, options.targetTimezone);
    const end = fromIsoDateTime(event.endDate, options.targetTimezone);
    const location =
      typeof event.location === "string"
        ? event.location
        : event.location &&
            typeof event.location === "object" &&
            typeof (event.location as Record<string, unknown>).name === "string"
          ? String((event.location as Record<string, unknown>).name)
          : undefined;
    const address =
      event.location && typeof event.location === "object"
        ? jsonLdAddress((event.location as Record<string, unknown>).address)
        : jsonLdAddress(event.address);
    structured = {
      title: typeof event.name === "string" ? event.name.trim() : options.titleHint,
      description:
        typeof event.description === "string"
          ? event.description.trim().slice(0, 10_000)
          : undefined,
      location,
      address,
      ...start,
      endDate: end.startDate,
      endTime: end.startTime,
    };
    break;
  }

  const loose = parseLooseText(text);
  return withDefaultEnd({
    title:
      structured.title ??
      options.titleHint?.trim() ??
      loose.title,
    description: structured.description ?? loose.description,
    startDate:
      labelled.startDate ??
      structured.startDate ??
      loose.startDate,
    endDate:
      labelled.endDate ??
      structured.endDate ??
      loose.endDate,
    startTime:
      labelled.startTime ??
      structured.startTime ??
      loose.startTime,
    endTime:
      labelled.endTime ??
      structured.endTime ??
      loose.endTime,
    timezone: structured.timezone ?? loose.timezone,
    allDay: structured.allDay ?? loose.allDay,
    repeat: structured.repeat ?? loose.repeat,
    location:
      labelled.location ??
      structured.location ??
      loose.location ??
      (options.sourceUrl &&
      /(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com)/i.test(
        options.sourceUrl,
      )
        ? options.sourceUrl
        : undefined),
    address: labelled.address ?? structured.address ?? loose.address,
  });
}
