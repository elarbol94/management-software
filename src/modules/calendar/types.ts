import type {
  calendarEventKinds,
  calendarResponses,
  calendarRoles,
  calendarViews,
} from "./schema";

export type CalendarView = (typeof calendarViews)[number];
export type CalendarRole = (typeof calendarRoles)[number];
export type CalendarEventKind = (typeof calendarEventKinds)[number];
export type CalendarResponse = (typeof calendarResponses)[number];

export type CalendarItemKind =
  | "event"
  | "focus"
  | "deadline"
  | "task"
  | "milestone"
  | "project";

export type CalendarItem = {
  id: string;
  sourceId: string;
  kind: CalendarItemKind;
  title: string;
  description: string;
  location: string;
  address: string;
  color: string;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  href: string | null;
  editable: boolean;
  availability: "busy" | "free";
  calendarId: string | null;
  projectId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  attendeeIds: string[];
  occurrenceKey: string | null;
  recurring: boolean;
  recurrenceRule: string | null;
  detailsHidden?: boolean;
  updatedAt: string;
};

export type CalendarSource = {
  id: string;
  name: string;
  color: string;
  role: CalendarRole;
  visibility: "private" | "busy" | "company";
};

export type CalendarPreferencesValue = {
  timezone: string;
  weekStartsOn: number;
  workingDayStart: string;
  workingDayEnd: string;
  workingDays: number[];
  defaultView: CalendarView;
};

export type CalendarSavedViewValue = {
  id: string;
  name: string;
  view: CalendarView;
  filters: {
    sources?: string[];
    people?: string[];
    projects?: string[];
    calendars?: string[];
    query?: string;
  };
  isDefault: boolean;
};

export type CalendarWorkspace = {
  items: CalendarItem[];
  calendars: CalendarSource[];
  members: { id: string; name: string }[];
  projects: { id: string; name: string; color: string }[];
  unscheduledTasks: {
    id: string;
    title: string;
    assigneeId: string | null;
    assigneeName: string | null;
    projectId: string | null;
    projectName: string | null;
  }[];
  preferences: CalendarPreferencesValue;
  savedViews: CalendarSavedViewValue[];
};
