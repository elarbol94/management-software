import { requireUser } from "@/lib/auth";
import {
  addDays,
  endOfMonthWindow,
  isValidDate,
  localDateInZone,
  startOfWeek,
} from "@/modules/calendar/date-utils";
import { CalendarClient } from "@/modules/calendar/components/calendar-client";
import {
  getCalendarTimezone,
  listCalendarWorkspace,
} from "@/modules/calendar/queries";
import type { CalendarView } from "@/modules/calendar/types";

const views = new Set<CalendarView>(["week", "month", "agenda", "team"]);

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    sources?: string;
    people?: string;
    projects?: string;
    calendars?: string;
    query?: string;
    new?: string;
  }>;
}) {
  const [currentUser, query] = await Promise.all([
    requireUser(),
    searchParams,
  ]);
  const view = views.has(query.view as CalendarView)
    ? (query.view as CalendarView)
    : "week";
  const fallbackDate = localDateInZone(
    new Date(),
    getCalendarTimezone(currentUser.id),
  );
  const date = isValidDate(query.date ?? "") ? query.date! : fallbackDate;

  let from: string;
  let to: string;
  if (view === "month") {
    const month = endOfMonthWindow(date);
    from = startOfWeek(month.start, 1);
    to = addDays(from, 42);
  } else if (view === "agenda") {
    from = date;
    to = addDays(date, 30);
  } else {
    from = startOfWeek(date, 1);
    to = addDays(from, 7);
  }

  const workspace = listCalendarWorkspace({
    userId: currentUser.id,
    from,
    to,
  });

  return (
    <CalendarClient
      currentUser={{ id: currentUser.id, name: currentUser.name }}
      workspace={workspace}
      view={view}
      viewWasExplicit={views.has(query.view as CalendarView)}
      date={date}
      range={{ from, to }}
      initialFilters={{
        sources: query.sources?.split(",").filter(Boolean) ?? [],
        people: query.people?.split(",").filter(Boolean) ?? [],
        projects: query.projects?.split(",").filter(Boolean) ?? [],
        calendars: query.calendars?.split(",").filter(Boolean) ?? [],
        query: query.query ?? "",
      }}
      openNewEvent={query.new === "event"}
    />
  );
}
