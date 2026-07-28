import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/core-schema";
import {
  calendarEventAttendees,
  calendarEventExceptions,
  calendarEvents,
  calendarMemberships,
  calendarPreferences,
  calendarSavedViews,
  calendars,
} from "./schema";
import {
  projects,
  taskContexts,
  tasks,
} from "@/modules/projects/schema";
import { addDays, overlapsDateRange, parseDate } from "./date-utils";
import { expandEventOccurrences } from "./recurrence";
import type {
  CalendarItem,
  CalendarRole,
  CalendarSavedViewValue,
  CalendarWorkspace,
} from "./types";

const DEFAULT_TIMEZONE = "Europe/Berlin";

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function ensureCalendarWorkspace(userId: string) {
  let ownCalendar = db
    .select()
    .from(calendars)
    .where(eq(calendars.ownerId, userId))
    .orderBy(asc(calendars.createdAt))
    .get();

  if (!ownCalendar) {
    ownCalendar = db
      .insert(calendars)
      .values({ ownerId: userId, name: "My calendar" })
      .returning()
      .get();
  }

  db.insert(calendarMemberships)
    .values({ calendarId: ownCalendar.id, userId, role: "owner" })
    .onConflictDoUpdate({
      target: [calendarMemberships.calendarId, calendarMemberships.userId],
      set: { role: "owner" },
    })
    .run();

  db.insert(calendarPreferences)
    .values({ userId })
    .onConflictDoNothing()
    .run();

  return ownCalendar;
}

export function calendarRoleForUser(
  calendarId: string,
  userId: string,
): CalendarRole | null {
  const calendar = db
    .select()
    .from(calendars)
    .where(eq(calendars.id, calendarId))
    .get();
  if (!calendar) return null;
  if (calendar.ownerId === userId) return "owner";
  if (calendar.visibility === "private") return null;
  const membership = db
    .select({ role: calendarMemberships.role })
    .from(calendarMemberships)
    .where(
      and(
        eq(calendarMemberships.calendarId, calendarId),
        eq(calendarMemberships.userId, userId),
      ),
    )
    .get();
  if (membership) return membership.role;
  return calendar.visibility === "company" || calendar.visibility === "busy"
    ? "viewer"
    : null;
}

function listAccessibleCalendars(userId: string) {
  const rows = db
    .select()
    .from(calendars)
    .orderBy(asc(calendars.name))
    .all();
  return rows.flatMap((calendar) => {
    const role = calendarRoleForUser(calendar.id, userId);
    return role ? [{ ...calendar, role }] : [];
  });
}

function taskHref(
  id: string,
  projectId: string | null,
  contextRoute: string | null,
  kind: "task" | "deadline",
) {
  if (projectId) return `/projects/${projectId}?task=${id}`;
  if (contextRoute) {
    const separator = contextRoute.includes("?") ? "&" : "?";
    return `${contextRoute}${separator}${kind}=${id}`;
  }
  return "/";
}

export function listCalendarWorkspace(input: {
  userId: string;
  from: string;
  to: string;
}): CalendarWorkspace {
  ensureCalendarWorkspace(input.userId);
  const accessible = listAccessibleCalendars(input.userId);
  const calendarIds = accessible.map((calendar) => calendar.id);
  const rangeStart = parseDate(input.from);
  const rangeEnd = parseDate(input.to);
  const eventRows =
    calendarIds.length === 0
      ? []
      : db
          .select()
          .from(calendarEvents)
          .where(
            and(
              inArray(calendarEvents.calendarId, calendarIds),
              eq(calendarEvents.status, "confirmed"),
            ),
          )
          .all();
  const eventIds = eventRows.map((event) => event.id);
  const attendees =
    eventIds.length === 0
      ? []
      : db
          .select()
          .from(calendarEventAttendees)
          .where(inArray(calendarEventAttendees.eventId, eventIds))
          .all();
  const exceptions =
    eventIds.length === 0
      ? []
      : db
          .select()
          .from(calendarEventExceptions)
          .where(inArray(calendarEventExceptions.eventId, eventIds))
          .all();
  const attendeesByEvent = new Map<string, string[]>();
  for (const attendee of attendees) {
    const values = attendeesByEvent.get(attendee.eventId) ?? [];
    values.push(attendee.userId);
    attendeesByEvent.set(attendee.eventId, values);
  }
  const exceptionsByEvent = new Map<
    string,
    typeof calendarEventExceptions.$inferSelect[]
  >();
  for (const exception of exceptions) {
    const values = exceptionsByEvent.get(exception.eventId) ?? [];
    values.push(exception);
    exceptionsByEvent.set(exception.eventId, values);
  }
  const calendarById = new Map(
    accessible.map((calendar) => [calendar.id, calendar]),
  );

  const items: CalendarItem[] = [];
  for (const event of eventRows) {
    const calendar = calendarById.get(event.calendarId);
    if (!calendar) continue;
    const detailsHidden = calendar.visibility === "busy" && calendar.role === "viewer";
    const occurrences = expandEventOccurrences(
      event,
      exceptionsByEvent.get(event.id) ?? [],
      rangeStart,
      rangeEnd,
    );
    for (const occurrence of occurrences) {
      const visible = event.allDay
        ? Boolean(
            occurrence.startDate &&
              occurrence.endDate &&
              overlapsDateRange(
                occurrence.startDate,
                occurrence.endDate,
                input.from,
                input.to,
              ),
          )
        : Boolean(
            occurrence.startAt &&
              occurrence.endAt &&
              occurrence.startAt < rangeEnd &&
              occurrence.endAt > rangeStart,
          );
      if (!visible) continue;
      items.push({
        id: `${event.id}:${occurrence.occurrenceKey}`,
        sourceId: event.id,
        kind: event.kind === "focus" ? "focus" : "event",
        title: detailsHidden ? "Busy" : occurrence.title,
        description: detailsHidden ? "" : occurrence.description,
        location: detailsHidden ? "" : event.location,
        color: calendar.color,
        allDay: event.allDay,
        startDate: occurrence.startDate,
        endDate: occurrence.endDate,
        startAt: occurrence.startAt?.toISOString() ?? null,
        endAt: occurrence.endAt?.toISOString() ?? null,
        timezone: event.timezone,
        href: detailsHidden
          ? null
          : event.linkedTaskId
          ? taskHref(event.linkedTaskId, null, null, "task")
          : null,
        editable: calendar.role === "owner" || calendar.role === "editor",
        availability: event.availability,
        calendarId: event.calendarId,
        projectId: null,
        assigneeId: detailsHidden ? null : event.createdBy,
        assigneeName: null,
        attendeeIds: detailsHidden ? [] : attendeesByEvent.get(event.id) ?? [],
        occurrenceKey: occurrence.occurrenceKey,
        recurring: Boolean(event.recurrenceRule),
        recurrenceRule: detailsHidden ? null : event.recurrenceRule,
        detailsHidden,
        updatedAt: event.updatedAt.toISOString(),
      });
    }
  }

  const taskRows = db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      projectName: projects.name,
      projectColor: projects.color,
      title: tasks.title,
      description: tasks.description,
      kind: tasks.kind,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      deadlineAt: tasks.deadlineAt,
      isMilestone: tasks.isMilestone,
      status: tasks.status,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      contextRoute: taskContexts.route,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .leftJoin(taskContexts, eq(tasks.id, taskContexts.taskId))
    .where(
      and(
        eq(tasks.status, "open"),
        or(isNull(projects.status), eq(projects.status, "active")),
      ),
    )
    .all();

  for (const task of taskRows) {
    if (!task.dueDate && !task.startDate) continue;
    if (task.kind === "deadline" && task.deadlineAt) {
      const endAt = new Date(task.deadlineAt.getTime() + 30 * 60_000);
      if (task.deadlineAt < rangeEnd && endAt > rangeStart) {
        items.push({
          id: `deadline:${task.id}`,
          sourceId: task.id,
          kind: "deadline",
          title: task.title,
          description: task.description,
          location: "",
          color: "#D97706",
          allDay: false,
          startDate: null,
          endDate: null,
          startAt: task.deadlineAt.toISOString(),
          endAt: endAt.toISOString(),
          timezone: DEFAULT_TIMEZONE,
          href: taskHref(
            task.id,
            task.projectId,
            task.contextRoute,
            "deadline",
          ),
          editable: true,
          availability: "busy",
          calendarId: null,
          projectId: task.projectId,
          assigneeId: task.assigneeId,
          assigneeName: task.assigneeName,
          attendeeIds: task.assigneeId ? [task.assigneeId] : [],
          occurrenceKey: null,
          recurring: false,
          recurrenceRule: null,
          updatedAt: task.updatedAt.toISOString(),
        });
      }
      continue;
    }
    const startDate = task.startDate ?? task.dueDate!;
    const endDate = addDays(task.dueDate ?? task.startDate!, 1);
    if (!overlapsDateRange(startDate, endDate, input.from, input.to)) continue;
    items.push({
      id: `${task.kind}:${task.id}`,
      sourceId: task.id,
      kind:
        task.kind === "deadline"
          ? "deadline"
          : task.isMilestone
            ? "milestone"
            : "task",
      title: task.title,
      description: task.description,
      location: "",
      color:
        task.kind === "deadline"
          ? "#D97706"
          : task.projectColor ?? "#6D5EF7",
      allDay: true,
      startDate,
      endDate,
      startAt: null,
      endAt: null,
      timezone: null,
      href: taskHref(
        task.id,
        task.projectId,
        task.contextRoute,
        task.kind,
      ),
      editable: true,
      availability: "free",
      calendarId: null,
      projectId: task.projectId,
      assigneeId: task.assigneeId,
      assigneeName: task.assigneeName,
      attendeeIds: task.assigneeId ? [task.assigneeId] : [],
      occurrenceKey: null,
      recurring: false,
      recurrenceRule: null,
      updatedAt: task.updatedAt.toISOString(),
    });
  }

  const projectRows = db
    .select({
      id: projects.id,
      name: projects.name,
      color: projects.color,
      startDate: projects.plannedStartDate,
      dueDate: projects.targetEndDate,
      managerId: projects.managerId,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.status, "active"))
    .orderBy(asc(projects.name))
    .all();
  for (const project of projectRows) {
    if (!project.startDate || !project.dueDate) continue;
    const endDate = addDays(project.dueDate, 1);
    if (
      !overlapsDateRange(project.startDate, endDate, input.from, input.to)
    ) {
      continue;
    }
    items.push({
      id: `project:${project.id}`,
      sourceId: project.id,
      kind: "project",
      title: project.name,
      description: "",
      location: "",
      color: project.color,
      allDay: true,
      startDate: project.startDate,
      endDate,
      startAt: null,
      endAt: null,
      timezone: null,
      href: `/projects?project=${project.id}`,
      editable: true,
      availability: "free",
      calendarId: null,
      projectId: project.id,
      assigneeId: project.managerId,
      assigneeName: null,
      attendeeIds: project.managerId ? [project.managerId] : [],
      occurrenceKey: null,
      recurring: false,
      recurrenceRule: null,
      updatedAt: project.updatedAt.toISOString(),
    });
  }

  const unscheduledTasks = taskRows
    .filter(
      (task) =>
        task.kind === "task" &&
        !task.startDate &&
        !task.dueDate &&
        task.status === "open",
    )
    .map((task) => ({
      id: task.id,
      title: task.title,
      assigneeId: task.assigneeId,
      assigneeName: task.assigneeName,
      projectId: task.projectId,
      projectName: task.projectName,
    }));

  const preferencesRow = db
    .select()
    .from(calendarPreferences)
    .where(eq(calendarPreferences.userId, input.userId))
    .get()!;
  const savedViews: CalendarSavedViewValue[] = db
    .select()
    .from(calendarSavedViews)
    .where(eq(calendarSavedViews.userId, input.userId))
    .orderBy(asc(calendarSavedViews.name))
    .all()
    .map((view) => ({
      id: view.id,
      name: view.name,
      view: view.view,
      filters: parseJson(view.filterJson, {}),
      isDefault: view.isDefault,
    }));

  return {
    items: items.sort((left, right) =>
      (left.startAt ?? left.startDate ?? "").localeCompare(
        right.startAt ?? right.startDate ?? "",
      ),
    ),
    calendars: accessible.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
      role: calendar.role,
      visibility: calendar.visibility,
    })),
    members: db
      .select({ id: user.id, name: user.name })
      .from(user)
      .orderBy(asc(user.name))
      .all(),
    projects: projectRows.map((project) => ({
      id: project.id,
      name: project.name,
      color: project.color,
    })),
    unscheduledTasks,
    preferences: {
      timezone: preferencesRow.timezone,
      weekStartsOn: preferencesRow.weekStartsOn,
      workingDayStart: preferencesRow.workingDayStart,
      workingDayEnd: preferencesRow.workingDayEnd,
      workingDays: parseJson(preferencesRow.workingDaysJson, [1, 2, 3, 4, 5]),
      defaultView: preferencesRow.defaultView,
    },
    savedViews,
  };
}
