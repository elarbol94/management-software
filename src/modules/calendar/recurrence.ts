import { RRule, datetime } from "rrule";
import {
  addDays,
  daysBetween,
  isoDate,
  parseDate,
  zonedDateTimeToUtc,
  zonedParts,
} from "./date-utils";

export type RecurringEvent = {
  id: string;
  title: string;
  description: string;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  startAt: Date | null;
  endAt: Date | null;
  timezone: string;
  recurrenceRule: string | null;
};

export type EventException = {
  occurrenceKey: string;
  cancelled: boolean;
  overrideJson: string;
};

export type ExpandedOccurrence = {
  occurrenceKey: string;
  title: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  startAt: Date | null;
  endAt: Date | null;
};

function parseRule(rule: string) {
  const value = rule
    .split(/\r?\n/)
    .find((line) => line.startsWith("RRULE:"))
    ?.slice(6) ?? rule.replace(/^RRULE:/, "");
  return RRule.parseString(value);
}

export function validateRecurrenceRule(rule: string | null) {
  if (!rule) return null;
  const value = rule.trim();
  if (!/(^|\n)(RRULE:)?FREQ=/.test(value)) {
    throw new Error("Invalid recurrence rule");
  }
  parseRule(value);
  return value.replace(/^RRULE:/, "");
}

function exceptionOverrides(value: string) {
  try {
    return JSON.parse(value) as Partial<ExpandedOccurrence>;
  } catch {
    return {};
  }
}

export function expandEventOccurrences(
  event: RecurringEvent,
  exceptions: EventException[],
  rangeStart: Date,
  rangeEnd: Date,
): ExpandedOccurrence[] {
  const exceptionByKey = new Map(
    exceptions.map((exception) => [exception.occurrenceKey, exception]),
  );

  const applyException = (occurrence: ExpandedOccurrence) => {
    const exception = exceptionByKey.get(occurrence.occurrenceKey);
    if (exception?.cancelled) return null;
    if (!exception) return occurrence;
    return { ...occurrence, ...exceptionOverrides(exception.overrideJson) };
  };

  if (!event.recurrenceRule) {
    const occurrence: ExpandedOccurrence = {
      occurrenceKey: event.allDay
        ? event.startDate ?? event.id
        : event.startAt?.toISOString() ?? event.id,
      title: event.title,
      description: event.description,
      startDate: event.startDate,
      endDate: event.endDate,
      startAt: event.startAt,
      endAt: event.endAt,
    };
    const adjusted = applyException(occurrence);
    return adjusted ? [adjusted] : [];
  }

  const options = parseRule(event.recurrenceRule);
  if (event.allDay) {
    if (!event.startDate || !event.endDate) return [];
    const durationDays = Math.max(1, daysBetween(event.startDate, event.endDate));
    const start = parseDate(event.startDate);
    const rule = new RRule({ ...options, dtstart: start });
    return rule
      .between(
        new Date(rangeStart.getTime() - durationDays * 86_400_000),
        rangeEnd,
        true,
      )
      .map((date) => {
        const occurrenceDate = isoDate(date);
        return applyException({
          occurrenceKey: occurrenceDate,
          title: event.title,
          description: event.description,
          startDate: occurrenceDate,
          endDate: addDays(occurrenceDate, durationDays),
          startAt: null,
          endAt: null,
        });
      })
      .filter((value): value is ExpandedOccurrence => Boolean(value));
  }

  if (!event.startAt || !event.endAt) return [];
  const duration = event.endAt.getTime() - event.startAt.getTime();
  const parts = zonedParts(event.startAt, event.timezone);
  const wallClockStart = datetime(
    parts.year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const rule = new RRule({
    ...options,
    dtstart: wallClockStart,
  });
  return rule
    .between(
      new Date(rangeStart.getTime() - duration - 14 * 60 * 60_000),
      new Date(rangeEnd.getTime() + 14 * 60 * 60_000),
      true,
    )
    .map((wallClockDate) => {
      const date = zonedDateTimeToUtc(
        {
          year: wallClockDate.getUTCFullYear(),
          month: wallClockDate.getUTCMonth() + 1,
          day: wallClockDate.getUTCDate(),
          hour: wallClockDate.getUTCHours(),
          minute: wallClockDate.getUTCMinutes(),
          second: wallClockDate.getUTCSeconds(),
        },
        event.timezone,
      );
      return (
      applyException({
        occurrenceKey: date.toISOString(),
        title: event.title,
        description: event.description,
        startDate: null,
        endDate: null,
        startAt: date,
        endAt: new Date(date.getTime() + duration),
      })
      );
    })
    .filter((value): value is ExpandedOccurrence => Boolean(value));
}
