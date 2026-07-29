const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function parseDate(date: string) {
  if (!DATE_PATTERN.test(date)) throw new Error("Invalid calendar date");
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (isoDate(value) !== date) throw new Error("Invalid calendar date");
  return value;
}

export function isValidDate(date: string) {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: string, amount: number) {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return isoDate(value);
}

export function daysBetween(start: string, endExclusive: string) {
  return Math.round(
    (parseDate(endExclusive).getTime() - parseDate(start).getTime()) /
      86_400_000,
  );
}

export function startOfWeek(date: string, weekStartsOn = 1) {
  const value = parseDate(date);
  const delta = (value.getUTCDay() - weekStartsOn + 7) % 7;
  value.setUTCDate(value.getUTCDate() - delta);
  return isoDate(value);
}

export function endOfMonthWindow(date: string) {
  const value = parseDate(date);
  const start = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1),
  );
  const end = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1),
  );
  return { start: isoDate(start), end: isoDate(end) };
}

export function overlapsDateRange(
  start: string,
  endExclusive: string,
  rangeStart: string,
  rangeEnd: string,
) {
  return start < rangeEnd && endExclusive > rangeStart;
}

export function dateRange(start: string, endExclusive: string, limit = 62) {
  const dates: string[] = [];
  let cursor = start;
  while (cursor < endExclusive && dates.length < limit) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function localDateInZone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function dateAndMinutesInZone(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  return {
    date: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    minutes: parts.hour * 60 + parts.minute,
  };
}

export function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
    second: Number(value.second),
  };
}

export function zonedDateTimeToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timezone: string,
) {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
  );
  let guess = desired;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observedParts = zonedParts(new Date(guess), timezone);
    const observed = Date.UTC(
      observedParts.year,
      observedParts.month - 1,
      observedParts.day,
      observedParts.hour,
      observedParts.minute,
      observedParts.second,
    );
    const correction = desired - observed;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}
