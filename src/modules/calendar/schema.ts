import { createId } from "@paralleldrive/cuid2";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "@/db/core-schema";
import { tasks } from "@/modules/projects/schema";

export const calendarVisibilities = ["private", "busy", "company"] as const;
export const calendarRoles = ["viewer", "editor", "owner"] as const;
export const calendarEventKinds = ["event", "focus", "absence"] as const;
export const calendarAvailabilities = ["busy", "free"] as const;
export const calendarResponses = [
  "needs_action",
  "accepted",
  "tentative",
  "declined",
] as const;
export const calendarViews = ["week", "month", "agenda", "team"] as const;

export const calendars = sqliteTable(
  "calendars",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6D5EF7"),
    visibility: text("visibility", { enum: calendarVisibilities })
      .notNull()
      .default("private"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("calendars_owner_idx").on(table.ownerId),
    index("calendars_visibility_idx").on(table.visibility),
  ],
);

export const calendarMemberships = sqliteTable(
  "calendar_memberships",
  {
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: calendarRoles }).notNull().default("viewer"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.calendarId, table.userId] }),
    index("calendar_memberships_user_idx").on(table.userId),
  ],
);

export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    calendarId: text("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: calendarEventKinds })
      .notNull()
      .default("event"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    location: text("location").notNull().default(""),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    startDate: text("start_date"),
    endDate: text("end_date"),
    startAt: integer("start_at", { mode: "timestamp_ms" }),
    endAt: integer("end_at", { mode: "timestamp_ms" }),
    timezone: text("timezone").notNull().default("Europe/Berlin"),
    availability: text("availability", { enum: calendarAvailabilities })
      .notNull()
      .default("busy"),
    recurrenceRule: text("recurrence_rule"),
    linkedTaskId: text("linked_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["confirmed", "cancelled"] })
      .notNull()
      .default("confirmed"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("calendar_events_calendar_idx").on(table.calendarId),
    index("calendar_events_timed_range_idx").on(table.startAt, table.endAt),
    index("calendar_events_all_day_range_idx").on(
      table.startDate,
      table.endDate,
    ),
    index("calendar_events_linked_task_idx").on(table.linkedTaskId),
  ],
);

export const calendarEventAttendees = sqliteTable(
  "calendar_event_attendees",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    response: text("response", { enum: calendarResponses })
      .notNull()
      .default("needs_action"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
    index("calendar_event_attendees_user_idx").on(table.userId),
  ],
);

export const calendarEventExceptions = sqliteTable(
  "calendar_event_exceptions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    eventId: text("event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    occurrenceKey: text("occurrence_key").notNull(),
    cancelled: integer("cancelled", { mode: "boolean" })
      .notNull()
      .default(false),
    overrideJson: text("override_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("calendar_event_exceptions_occurrence_idx").on(
      table.eventId,
      table.occurrenceKey,
    ),
  ],
);

export const calendarReminders = sqliteTable(
  "calendar_reminders",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    eventId: text("event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    minutesBefore: integer("minutes_before").notNull().default(15),
    channel: text("channel", { enum: ["in_app"] })
      .notNull()
      .default("in_app"),
  },
  (table) => [
    index("calendar_reminders_user_idx").on(table.userId),
    uniqueIndex("calendar_reminders_unique_idx").on(
      table.eventId,
      table.userId,
      table.minutesBefore,
    ),
  ],
);

export const calendarReminderDeliveries = sqliteTable(
  "calendar_reminder_deliveries",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    reminderId: text("reminder_id")
      .notNull()
      .references(() => calendarReminders.id, { onDelete: "cascade" }),
    occurrenceKey: text("occurrence_key").notNull(),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("calendar_reminder_deliveries_unique_idx").on(
      table.reminderId,
      table.occurrenceKey,
    ),
  ],
);

export const calendarSavedViews = sqliteTable(
  "calendar_saved_views",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    view: text("view", { enum: calendarViews }).notNull().default("week"),
    filterJson: text("filter_json").notNull().default("{}"),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("calendar_saved_views_user_idx").on(table.userId),
    uniqueIndex("calendar_saved_views_name_idx").on(table.userId, table.name),
  ],
);

export const calendarPreferences = sqliteTable("calendar_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  weekStartsOn: integer("week_starts_on").notNull().default(1),
  workingDayStart: text("working_day_start").notNull().default("08:00"),
  workingDayEnd: text("working_day_end").notNull().default("17:00"),
  workingDaysJson: text("working_days_json")
    .notNull()
    .default("[1,2,3,4,5]"),
  defaultView: text("default_view", { enum: calendarViews })
    .notNull()
    .default("week"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
