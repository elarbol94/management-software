"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, lt, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/core-schema";
import { requireUserOrThrow } from "@/lib/auth";
import { tasks } from "@/modules/projects/schema";
import {
  calendarEventAttendees,
  calendarEventExceptions,
  calendarEvents,
  calendarMemberships,
  calendarPreferences,
  calendarReminderDeliveries,
  calendarReminders,
  calendarSavedViews,
  calendars,
} from "./schema";
import { calendarRoleForUser, ensureCalendarWorkspace } from "./queries";
import { validateRecurrenceRule } from "./recurrence";
import { zonedParts } from "./date-utils";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^\d{2}:\d{2}$/;

const eventInputSchema = z
  .object({
    id: z.string().optional(),
    calendarId: z.string().min(1),
    kind: z.enum(["event", "focus", "absence"]).default("event"),
    title: z.string().trim().min(1).max(240),
    description: z.string().max(10_000).default(""),
    location: z.string().max(500).default(""),
    allDay: z.boolean(),
    startDate: z.string().regex(datePattern).nullable(),
    endDate: z.string().regex(datePattern).nullable(),
    startAt: z.string().datetime().nullable(),
    endAt: z.string().datetime().nullable(),
    timezone: z.string().trim().min(1).max(120),
    availability: z.enum(["busy", "free"]).default("busy"),
    recurrenceRule: z.string().max(1000).nullable(),
    linkedTaskId: z.string().nullable().default(null),
    attendeeIds: z.array(z.string()).max(100).default([]),
    reminderMinutes: z.array(z.number().int().min(0).max(43_200)).max(8).default([]),
    expectedUpdatedAt: z.string().datetime().nullable().default(null),
    allowConflicts: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.allDay) {
      if (!value.startDate || !value.endDate || value.endDate <= value.startDate) {
        ctx.addIssue({
          code: "custom",
          message: "All-day events require an end date after the start date",
          path: ["endDate"],
        });
      }
    } else {
      if (!value.startAt || !value.endAt) {
        ctx.addIssue({
          code: "custom",
          message: "Timed events require a start and end",
          path: ["startAt"],
        });
      } else if (new Date(value.endAt) <= new Date(value.startAt)) {
        ctx.addIssue({
          code: "custom",
          message: "The end must be after the start",
          path: ["endAt"],
        });
      }
    }
  });

export type CalendarEventInput = z.input<typeof eventInputSchema>;

function requireCalendarEditor(calendarId: string, userId: string) {
  const role = calendarRoleForUser(calendarId, userId);
  if (role !== "owner" && role !== "editor") {
    throw new Error("You do not have permission to edit this calendar");
  }
  return role;
}

function accessibleUserIds(ids: string[]) {
  if (ids.length === 0) return [];
  const valid = new Set(
    db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.id, ids))
      .all()
      .map((row) => row.id),
  );
  return [...new Set(ids)].filter((id) => valid.has(id));
}

function timedConflicts(input: {
  eventId?: string;
  startAt: Date;
  endAt: Date;
  attendeeIds: string[];
  userId: string;
}) {
  const relevantUsers = [...new Set([input.userId, ...input.attendeeIds])];
  if (relevantUsers.length === 0) return [];
  const busyEvents = db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      startAt: calendarEvents.startAt,
      endAt: calendarEvents.endAt,
      createdBy: calendarEvents.createdBy,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.allDay, false),
        eq(calendarEvents.availability, "busy"),
        eq(calendarEvents.status, "confirmed"),
        lt(calendarEvents.startAt, input.endAt),
        gt(calendarEvents.endAt, input.startAt),
      ),
    )
    .all()
    .filter((event) => event.id !== input.eventId);
  if (busyEvents.length === 0) return [];
  const attendeeRows = db
    .select()
    .from(calendarEventAttendees)
    .where(
      and(
        inArray(
          calendarEventAttendees.eventId,
          busyEvents.map((event) => event.id),
        ),
        inArray(calendarEventAttendees.userId, relevantUsers),
      ),
    )
    .all();
  const conflictedIds = new Set(
    busyEvents
      .filter((event) => relevantUsers.includes(event.createdBy))
      .map((event) => event.id),
  );
  for (const attendee of attendeeRows) conflictedIds.add(attendee.eventId);
  return busyEvents
    .filter((event) => conflictedIds.has(event.id))
    .map((event) => ({
      id: event.id,
      title: event.title,
      startAt: event.startAt?.toISOString() ?? "",
      endAt: event.endAt?.toISOString() ?? "",
    }));
}

export async function upsertCalendarEvent(input: CalendarEventInput) {
  const currentUser = await requireUserOrThrow();
  const data = eventInputSchema.parse(input);
  requireCalendarEditor(data.calendarId, currentUser.id);
  const recurrenceRule = validateRecurrenceRule(data.recurrenceRule);
  const attendeeIds = accessibleUserIds(data.attendeeIds).filter(
    (id) => id !== currentUser.id,
  );
  const startAt = data.startAt ? new Date(data.startAt) : null;
  const endAt = data.endAt ? new Date(data.endAt) : null;
  const conflicts =
    !data.allDay && data.availability === "busy" && startAt && endAt
      ? timedConflicts({
          eventId: data.id,
          startAt,
          endAt,
          attendeeIds,
          userId: currentUser.id,
        })
      : [];
  if (conflicts.length > 0 && !data.allowConflicts) {
    return { status: "conflict" as const, conflicts };
  }

  const now = new Date();
  const id = data.id ?? createId();
  db.transaction((tx) => {
    if (data.id) {
      const existing = tx
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, data.id))
        .get();
      if (!existing) throw new Error("Event not found");
      requireCalendarEditor(existing.calendarId, currentUser.id);
      if (
        data.expectedUpdatedAt &&
        existing.updatedAt.toISOString() !== data.expectedUpdatedAt
      ) {
        throw new Error("Event changed in another session");
      }
      tx.update(calendarEvents)
        .set({
          calendarId: data.calendarId,
          kind: data.kind,
          title: data.title,
          description: data.description,
          location: data.location,
          allDay: data.allDay,
          startDate: data.allDay ? data.startDate : null,
          endDate: data.allDay ? data.endDate : null,
          startAt: data.allDay ? null : startAt,
          endAt: data.allDay ? null : endAt,
          timezone: data.timezone,
          availability: data.availability,
          recurrenceRule,
          linkedTaskId: data.linkedTaskId,
          updatedAt: now,
        })
        .where(eq(calendarEvents.id, id))
        .run();
    } else {
      tx.insert(calendarEvents)
        .values({
          id,
          calendarId: data.calendarId,
          kind: data.kind,
          title: data.title,
          description: data.description,
          location: data.location,
          allDay: data.allDay,
          startDate: data.allDay ? data.startDate : null,
          endDate: data.allDay ? data.endDate : null,
          startAt: data.allDay ? null : startAt,
          endAt: data.allDay ? null : endAt,
          timezone: data.timezone,
          availability: data.availability,
          recurrenceRule,
          linkedTaskId: data.linkedTaskId,
          createdBy: currentUser.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    tx.delete(calendarEventAttendees)
      .where(eq(calendarEventAttendees.eventId, id))
      .run();
    if (attendeeIds.length > 0) {
      tx.insert(calendarEventAttendees)
        .values(
          attendeeIds.map((userId) => ({
            eventId: id,
            userId,
            response: "needs_action" as const,
          })),
        )
        .run();
    }
    tx.delete(calendarReminders)
      .where(
        and(
          eq(calendarReminders.eventId, id),
          eq(calendarReminders.userId, currentUser.id),
        ),
      )
      .run();
    const reminderMinutes = [...new Set(data.reminderMinutes)];
    if (reminderMinutes.length > 0) {
      tx.insert(calendarReminders)
        .values(
          reminderMinutes.map((minutesBefore) => ({
            eventId: id,
            userId: currentUser.id,
            minutesBefore,
          })),
        )
        .run();
    }
  });
  revalidatePath("/calendar");
  revalidatePath("/");
  return { status: "saved" as const, id, updatedAt: now.toISOString() };
}

export async function deleteCalendarEvent(id: string) {
  const currentUser = await requireUserOrThrow();
  const event = db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, id))
    .get();
  if (!event) throw new Error("Event not found");
  requireCalendarEditor(event.calendarId, currentUser.id);
  db.update(calendarEvents)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(calendarEvents.id, id))
    .run();
  revalidatePath("/calendar");
  revalidatePath("/");
}

export async function moveCalendarEvent(input: {
  id: string;
  startAt?: string;
  endAt?: string;
  startDate?: string;
  endDate?: string;
  expectedUpdatedAt: string;
  allowConflicts?: boolean;
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      id: z.string().min(1),
      startAt: z.string().datetime().optional(),
      endAt: z.string().datetime().optional(),
      startDate: z.string().regex(datePattern).optional(),
      endDate: z.string().regex(datePattern).optional(),
      expectedUpdatedAt: z.string().datetime(),
      allowConflicts: z.boolean().default(false),
    })
    .parse(input);
  const event = db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, data.id))
    .get();
  if (!event) throw new Error("Event not found");
  requireCalendarEditor(event.calendarId, currentUser.id);
  if (event.updatedAt.toISOString() !== data.expectedUpdatedAt) {
    throw new Error("Event changed in another session");
  }
  const attendees = db
    .select({ userId: calendarEventAttendees.userId })
    .from(calendarEventAttendees)
    .where(eq(calendarEventAttendees.eventId, event.id))
    .all()
    .map((row) => row.userId);
  const startAt = data.startAt ? new Date(data.startAt) : null;
  const endAt = data.endAt ? new Date(data.endAt) : null;
  const conflicts =
    !event.allDay && startAt && endAt
      ? timedConflicts({
          eventId: event.id,
          startAt,
          endAt,
          attendeeIds: attendees,
          userId: event.createdBy,
        })
      : [];
  if (conflicts.length > 0 && !data.allowConflicts) {
    return { status: "conflict" as const, conflicts };
  }
  const now = new Date();
  db.update(calendarEvents)
    .set(
      event.allDay
        ? {
            startDate: data.startDate,
            endDate: data.endDate,
            updatedAt: now,
          }
        : { startAt, endAt, updatedAt: now },
    )
    .where(eq(calendarEvents.id, event.id))
    .run();
  revalidatePath("/calendar");
  return { status: "saved" as const, updatedAt: now.toISOString() };
}

const occurrenceSchema = z.object({
  eventId: z.string().min(1),
  occurrenceKey: z.string().min(1).max(200),
  cancelled: z.boolean().default(false),
  override: z
    .object({
      title: z.string().trim().min(1).max(240).optional(),
      description: z.string().max(10_000).optional(),
      startDate: z.string().regex(datePattern).optional(),
      endDate: z.string().regex(datePattern).optional(),
      startAt: z.string().datetime().optional(),
      endAt: z.string().datetime().optional(),
    })
    .default({}),
});

export async function upsertCalendarOccurrence(
  input: z.input<typeof occurrenceSchema>,
) {
  const currentUser = await requireUserOrThrow();
  const data = occurrenceSchema.parse(input);
  const event = db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, data.eventId))
    .get();
  if (!event) throw new Error("Event not found");
  requireCalendarEditor(event.calendarId, currentUser.id);
  const now = new Date();
  db.insert(calendarEventExceptions)
    .values({
      eventId: event.id,
      occurrenceKey: data.occurrenceKey,
      cancelled: data.cancelled,
      overrideJson: JSON.stringify(data.override),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        calendarEventExceptions.eventId,
        calendarEventExceptions.occurrenceKey,
      ],
      set: {
        cancelled: data.cancelled,
        overrideJson: JSON.stringify(data.override),
        updatedAt: now,
      },
    })
    .run();
  revalidatePath("/calendar");
}

function recurrenceWithoutBoundary(rule: string) {
  return rule
    .replace(/^RRULE:/, "")
    .split(";")
    .filter(
      (part) =>
        !part.toUpperCase().startsWith("UNTIL=") &&
        !part.toUpperCase().startsWith("COUNT="),
    )
    .join(";");
}

function formatRRuleUntil(date: Date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}Z`;
}

function recurrenceRuleBefore(
  rule: string,
  occurrenceKey: string,
  allDay: boolean,
  timezone: string,
) {
  let wallClockOccurrence: Date;
  if (allDay) {
    wallClockOccurrence = new Date(`${occurrenceKey}T00:00:00.000Z`);
  } else {
    const parts = zonedParts(new Date(occurrenceKey), timezone);
    wallClockOccurrence = new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      ),
    );
  }
  const until = new Date(wallClockOccurrence.getTime() - 1000);
  return `${recurrenceWithoutBoundary(rule)};UNTIL=${formatRRuleUntil(until)}`;
}

export async function splitCalendarEventSeries(input: {
  event: CalendarEventInput;
  occurrenceKey: string;
}) {
  const currentUser = await requireUserOrThrow();
  const occurrenceKey = z.string().min(1).max(200).parse(input.occurrenceKey);
  const data = eventInputSchema.parse(input.event);
  if (!data.id) throw new Error("Recurring event ID is required");
  const existing = db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, data.id))
    .get();
  if (!existing?.recurrenceRule) throw new Error("Recurring event not found");
  requireCalendarEditor(existing.calendarId, currentUser.id);
  requireCalendarEditor(data.calendarId, currentUser.id);
  if (
    data.expectedUpdatedAt &&
    existing.updatedAt.toISOString() !== data.expectedUpdatedAt
  ) {
    throw new Error("Event changed in another session");
  }
  const startAt = data.startAt ? new Date(data.startAt) : null;
  const endAt = data.endAt ? new Date(data.endAt) : null;
  const attendeeIds = accessibleUserIds(data.attendeeIds).filter(
    (id) => id !== currentUser.id,
  );
  const conflicts =
    !data.allDay && data.availability === "busy" && startAt && endAt
      ? timedConflicts({
          eventId: existing.id,
          startAt,
          endAt,
          attendeeIds,
          userId: currentUser.id,
        })
      : [];
  if (conflicts.length > 0 && !data.allowConflicts) {
    return { status: "conflict" as const, conflicts };
  }

  const now = new Date();
  const newId = createId();
  const futureRule = recurrenceWithoutBoundary(existing.recurrenceRule);
  const priorRule = recurrenceRuleBefore(
    existing.recurrenceRule,
    occurrenceKey,
    existing.allDay,
    existing.timezone,
  );
  db.transaction((tx) => {
    tx.update(calendarEvents)
      .set({ recurrenceRule: priorRule, updatedAt: now })
      .where(eq(calendarEvents.id, existing.id))
      .run();
    tx.insert(calendarEvents)
      .values({
        id: newId,
        calendarId: data.calendarId,
        kind: data.kind,
        title: data.title,
        description: data.description,
        location: data.location,
        allDay: data.allDay,
        startDate: data.allDay ? data.startDate : null,
        endDate: data.allDay ? data.endDate : null,
        startAt: data.allDay ? null : startAt,
        endAt: data.allDay ? null : endAt,
        timezone: data.timezone,
        availability: data.availability,
        recurrenceRule: futureRule,
        linkedTaskId: data.linkedTaskId,
        createdBy: currentUser.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (attendeeIds.length > 0) {
      tx.insert(calendarEventAttendees)
        .values(
          attendeeIds.map((userId) => ({
            eventId: newId,
            userId,
            response: "needs_action" as const,
          })),
        )
        .run();
    }
    const reminderMinutes = [...new Set(data.reminderMinutes)];
    if (reminderMinutes.length > 0) {
      tx.insert(calendarReminders)
        .values(
          reminderMinutes.map((minutesBefore) => ({
            eventId: newId,
            userId: currentUser.id,
            minutesBefore,
          })),
        )
        .run();
    }
  });
  revalidatePath("/calendar");
  return { status: "saved" as const, id: newId, updatedAt: now.toISOString() };
}

export async function truncateCalendarEventSeries(input: {
  eventId: string;
  occurrenceKey: string;
  expectedUpdatedAt: string;
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      eventId: z.string().min(1),
      occurrenceKey: z.string().min(1).max(200),
      expectedUpdatedAt: z.string().datetime(),
    })
    .parse(input);
  const existing = db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, data.eventId))
    .get();
  if (!existing?.recurrenceRule) throw new Error("Recurring event not found");
  requireCalendarEditor(existing.calendarId, currentUser.id);
  if (existing.updatedAt.toISOString() !== data.expectedUpdatedAt) {
    throw new Error("Event changed in another session");
  }
  db.update(calendarEvents)
    .set({
      recurrenceRule: recurrenceRuleBefore(
        existing.recurrenceRule,
        data.occurrenceKey,
        existing.allDay,
        existing.timezone,
      ),
      updatedAt: new Date(),
    })
    .where(eq(calendarEvents.id, existing.id))
    .run();
  revalidatePath("/calendar");
}

export async function respondToCalendarEvent(input: {
  eventId: string;
  response: "accepted" | "tentative" | "declined";
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      eventId: z.string().min(1),
      response: z.enum(["accepted", "tentative", "declined"]),
    })
    .parse(input);
  const result = db
    .update(calendarEventAttendees)
    .set({ response: data.response, updatedAt: new Date() })
    .where(
      and(
        eq(calendarEventAttendees.eventId, data.eventId),
        eq(calendarEventAttendees.userId, currentUser.id),
      ),
    )
    .run();
  if (result.changes === 0) throw new Error("Invitation not found");
  revalidatePath("/calendar");
}

export async function createCalendar(input: {
  name: string;
  color: string;
  visibility: "private" | "company";
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      name: z.string().trim().min(1).max(120),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      visibility: z.enum(["private", "company"]),
    })
    .parse(input);
  const calendar = db
    .insert(calendars)
    .values({ ...data, ownerId: currentUser.id })
    .returning()
    .get();
  db.insert(calendarMemberships)
    .values({ calendarId: calendar.id, userId: currentUser.id, role: "owner" })
    .run();
  revalidatePath("/calendar");
  return calendar.id;
}

export async function setCalendarMember(input: {
  calendarId: string;
  userId: string;
  role: "viewer" | "editor";
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      calendarId: z.string().min(1),
      userId: z.string().min(1),
      role: z.enum(["viewer", "editor"]),
    })
    .parse(input);
  if (calendarRoleForUser(data.calendarId, currentUser.id) !== "owner") {
    throw new Error("Only the owner can share this calendar");
  }
  db.insert(calendarMemberships)
    .values(data)
    .onConflictDoUpdate({
      target: [calendarMemberships.calendarId, calendarMemberships.userId],
      set: { role: data.role },
    })
    .run();
  revalidatePath("/calendar");
}

export async function saveCalendarView(input: {
  id?: string;
  name: string;
  view: "week" | "month" | "agenda" | "team";
  filters: {
    sources?: string[];
    people?: string[];
    projects?: string[];
    query?: string;
  };
  isDefault?: boolean;
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      id: z.string().optional(),
      name: z.string().trim().min(1).max(100),
      view: z.enum(["week", "month", "agenda", "team"]),
      filters: z.object({
        sources: z.array(z.string()).optional(),
        people: z.array(z.string()).optional(),
        projects: z.array(z.string()).optional(),
        query: z.string().max(200).optional(),
      }),
      isDefault: z.boolean().default(false),
    })
    .parse(input);
  if (data.id) {
    const existing = db
      .select({ userId: calendarSavedViews.userId })
      .from(calendarSavedViews)
      .where(eq(calendarSavedViews.id, data.id))
      .get();
    if (existing && existing.userId !== currentUser.id) {
      throw new Error("You cannot edit another user's saved view");
    }
  }
  const id = data.id ?? createId();
  db.transaction((tx) => {
    if (data.isDefault) {
      tx.update(calendarSavedViews)
        .set({ isDefault: false })
        .where(eq(calendarSavedViews.userId, currentUser.id))
        .run();
    }
    tx.insert(calendarSavedViews)
      .values({
        id,
        userId: currentUser.id,
        name: data.name,
        view: data.view,
        filterJson: JSON.stringify(data.filters),
        isDefault: data.isDefault,
      })
      .onConflictDoUpdate({
        target: calendarSavedViews.id,
        set: {
          name: data.name,
          view: data.view,
          filterJson: JSON.stringify(data.filters),
          isDefault: data.isDefault,
          updatedAt: new Date(),
        },
      })
      .run();
  });
  revalidatePath("/calendar");
  return id;
}

export async function updateCalendarPreferences(input: {
  timezone: string;
  weekStartsOn: number;
  workingDayStart: string;
  workingDayEnd: string;
  workingDays: number[];
  defaultView: "week" | "month" | "agenda" | "team";
}) {
  const currentUser = await requireUserOrThrow();
  const data = z
    .object({
      timezone: z.string().trim().min(1).max(120),
      weekStartsOn: z.number().int().min(0).max(6),
      workingDayStart: z.string().regex(timePattern),
      workingDayEnd: z.string().regex(timePattern),
      workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      defaultView: z.enum(["week", "month", "agenda", "team"]),
    })
    .parse(input);
  try {
    new Intl.DateTimeFormat("en", { timeZone: data.timezone }).format();
  } catch {
    throw new Error("Unknown timezone");
  }
  db.insert(calendarPreferences)
    .values({
      userId: currentUser.id,
      timezone: data.timezone,
      weekStartsOn: data.weekStartsOn,
      workingDayStart: data.workingDayStart,
      workingDayEnd: data.workingDayEnd,
      workingDaysJson: JSON.stringify(data.workingDays),
      defaultView: data.defaultView,
    })
    .onConflictDoUpdate({
      target: calendarPreferences.userId,
      set: {
        timezone: data.timezone,
        weekStartsOn: data.weekStartsOn,
        workingDayStart: data.workingDayStart,
        workingDayEnd: data.workingDayEnd,
        workingDaysJson: JSON.stringify(data.workingDays),
        defaultView: data.defaultView,
        updatedAt: new Date(),
      },
    })
    .run();
  revalidatePath("/calendar");
}

export async function createTaskFocusBlock(input: {
  taskId: string;
  calendarId: string;
  startAt: string;
  endAt: string;
  timezone: string;
}) {
  await requireUserOrThrow();
  const data = z
    .object({
      taskId: z.string().min(1),
      calendarId: z.string().min(1),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      timezone: z.string().min(1).max(120),
    })
    .parse(input);
  const task = db
    .select({ id: tasks.id, title: tasks.title, description: tasks.description })
    .from(tasks)
    .where(eq(tasks.id, data.taskId))
    .get();
  if (!task) throw new Error("Task not found");
  return upsertCalendarEvent({
    calendarId: data.calendarId,
    kind: "focus",
    title: task.title,
    description: task.description,
    location: "",
    allDay: false,
    startDate: null,
    endDate: null,
    startAt: data.startAt,
    endAt: data.endAt,
    timezone: data.timezone,
    availability: "busy",
    recurrenceRule: null,
    linkedTaskId: task.id,
    attendeeIds: [],
    reminderMinutes: [5],
    expectedUpdatedAt: null,
    allowConflicts: false,
  });
}

export async function claimDueCalendarReminders() {
  const currentUser = await requireUserOrThrow();
  ensureCalendarWorkspace(currentUser.id);
  const now = new Date();
  const lower = new Date(now.getTime() - 2 * 60_000);
  const upper = new Date(now.getTime() + 24 * 60 * 60_000);
  const candidates = db
    .select({
      reminderId: calendarReminders.id,
      minutesBefore: calendarReminders.minutesBefore,
      eventId: calendarEvents.id,
      title: calendarEvents.title,
      startAt: calendarEvents.startAt,
    })
    .from(calendarReminders)
    .innerJoin(calendarEvents, eq(calendarReminders.eventId, calendarEvents.id))
    .where(
      and(
        eq(calendarReminders.userId, currentUser.id),
        eq(calendarEvents.status, "confirmed"),
        eq(calendarEvents.allDay, false),
        gt(calendarEvents.startAt, lower),
        lt(calendarEvents.startAt, upper),
      ),
    )
    .all();
  const due = candidates.filter((candidate) => {
    if (!candidate.startAt) return false;
    const remindAt =
      candidate.startAt.getTime() - candidate.minutesBefore * 60_000;
    return remindAt <= now.getTime() && remindAt >= lower.getTime();
  });
  const delivered: { id: string; title: string; startAt: string }[] = [];
  db.transaction((tx) => {
    for (const reminder of due) {
      const occurrenceKey = reminder.startAt!.toISOString();
      const result = tx
        .insert(calendarReminderDeliveries)
        .values({ reminderId: reminder.reminderId, occurrenceKey })
        .onConflictDoNothing()
        .run();
      if (result.changes > 0) {
        delivered.push({
          id: reminder.eventId,
          title: reminder.title,
          startAt: occurrenceKey,
        });
      }
    }
  });
  return delivered;
}
