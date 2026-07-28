"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type DragEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Focus,
  FileUp,
  GripVertical,
  Link2,
  Loader2,
  MoreHorizontal,
  MapPin,
  Plus,
  Repeat2,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  applyPortfolioScheduleChange,
  moveContextualDeadline,
  previewPortfolioScheduleChange,
  reapplyPortfolioScheduleChange,
  revertPortfolioScheduleChange,
} from "@/modules/projects/actions";
import {
  claimDueCalendarReminders,
  createCalendar,
  createTaskFocusBlock,
  deleteCalendarEvent,
  moveCalendarEvent,
  saveCalendarView,
  splitCalendarEventSeries,
  updateCalendar,
  truncateCalendarEventSeries,
  upsertCalendarEvent,
  upsertCalendarOccurrence,
} from "../actions";
import {
  analyzeCalendarText,
  analyzeCalendarUrl,
} from "../import-actions";
import type { CalendarImportSuggestion } from "../import-parser";
import {
  addDays,
  dateRange,
  daysBetween,
  parseDate,
  startOfWeek,
  zonedDateTimeToUtc,
  zonedParts,
} from "../date-utils";
import type {
  CalendarItem,
  CalendarView,
  CalendarWorkspace,
} from "../types";
import { cn } from "@/lib/utils";

const SOURCE_TYPES = ["event", "focus", "deadline", "task", "project"] as const;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const PX_PER_MINUTE = 1;
const subscribeToClock = () => () => undefined;

type FilterState = {
  sources: string[];
  people: string[];
  projects: string[];
  calendars: string[];
  query: string;
};

type CalendarDraft = {
  id?: string;
  name: string;
  color: string;
  visibility: "private" | "busy" | "company";
};

type EventDraft = {
  id?: string;
  calendarId: string;
  kind: "event" | "focus" | "absence";
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  availability: "busy" | "free";
  repeat: "none" | "daily" | "weekly" | "monthly";
  attendeeIds: string[];
  reminderMinutes: number | null;
  expectedUpdatedAt: string | null;
  occurrenceKey: string | null;
  recurring: boolean;
  scope: "occurrence" | "future" | "series";
};

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateForTimedItem(item: CalendarItem) {
  return item.startAt ? localDate(new Date(item.startAt)) : "";
}

function startMinutes(item: CalendarItem) {
  if (!item.startAt) return 0;
  const value = new Date(item.startAt);
  return value.getHours() * 60 + value.getMinutes();
}

function endMinutes(item: CalendarItem) {
  if (!item.endAt) return startMinutes(item) + 30;
  const value = new Date(item.endAt);
  return value.getHours() * 60 + value.getMinutes();
}

function typeSource(item: CalendarItem) {
  if (item.kind === "milestone") return "task";
  return item.kind;
}

function blankDraft(
  calendarId: string,
  timezone: string,
  date = localDate(),
  hour = 9,
): EventDraft {
  return {
    calendarId,
    kind: "event",
    title: "",
    description: "",
    location: "",
    allDay: false,
    startDate: date,
    endDate: addDays(date, 1),
    startTime: `${String(hour).padStart(2, "0")}:00`,
    endTime: `${String(hour + 1).padStart(2, "0")}:00`,
    timezone,
    availability: "busy",
    repeat: "none",
    attendeeIds: [],
    reminderMinutes: 15,
    expectedUpdatedAt: null,
    occurrenceKey: null,
    recurring: false,
    scope: "series",
  };
}

function itemDraft(
  item: CalendarItem,
  fallbackCalendarId: string,
  timezone: string,
): EventDraft {
  const start = item.startAt ? new Date(item.startAt) : null;
  const end = item.endAt ? new Date(item.endAt) : null;
  const eventTimezone = item.timezone ?? timezone;
  const startParts = start ? zonedParts(start, eventTimezone) : null;
  const endParts = end ? zonedParts(end, eventTimezone) : null;
  const timedStartDate = startParts
    ? `${startParts.year}-${String(startParts.month).padStart(2, "0")}-${String(startParts.day).padStart(2, "0")}`
    : localDate();
  const timedEndDate = endParts
    ? `${endParts.year}-${String(endParts.month).padStart(2, "0")}-${String(endParts.day).padStart(2, "0")}`
    : addDays(timedStartDate, 1);
  const rule = item.recurrenceRule ?? "";
  return {
    id: item.sourceId,
    calendarId: item.calendarId ?? fallbackCalendarId,
    kind: item.kind === "focus" ? "focus" : "event",
    title: item.title,
    description: item.description,
    location: item.location,
    allDay: item.allDay,
    startDate: item.startDate ?? timedStartDate,
    endDate: item.endDate ?? timedEndDate,
    startTime: startParts
      ? `${String(startParts.hour).padStart(2, "0")}:${String(startParts.minute).padStart(2, "0")}`
      : "09:00",
    endTime: endParts
      ? `${String(endParts.hour).padStart(2, "0")}:${String(endParts.minute).padStart(2, "0")}`
      : "10:00",
    timezone: eventTimezone,
    availability: item.availability,
    repeat: rule.includes("FREQ=DAILY")
      ? "daily"
      : rule.includes("FREQ=WEEKLY")
        ? "weekly"
        : rule.includes("FREQ=MONTHLY")
          ? "monthly"
          : "none",
    attendeeIds: item.attendeeIds,
    reminderMinutes: 15,
    expectedUpdatedAt: item.updatedAt,
    occurrenceKey: item.occurrenceKey,
    recurring: item.recurring,
    scope: item.recurring ? "occurrence" : "series",
  };
}

function formatMinutes(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function isoWeekNumber(date: string) {
  const value = parseDate(date);
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

async function extractImportFileText(file: File) {
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("file_too_large");
  }
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const document = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 30); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      );
      if (pages.join("\n").length >= 240_000) break;
    }
    return pages.join("\n").slice(0, 240_000);
  }
  const supported =
    file.type.startsWith("text/") ||
    /\.(?:ics|txt|md|csv|json)$/i.test(file.name);
  if (!supported) throw new Error("unsupported_file");
  return (await file.text()).slice(0, 240_000);
}

function MiniMonth({
  date,
  today,
  onSelect,
  locale,
}: {
  date: string;
  today: string | null;
  onSelect: (date: string) => void;
  locale: string;
}) {
  const current = parseDate(date);
  const monthStart = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const gridStart = startOfWeek(monthStart, 1);
  const days = dateRange(gridStart, addDays(gridStart, 42));
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">
        {new Intl.DateTimeFormat(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(current)}
      </p>
      <div className="grid grid-cols-7 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {Array.from({ length: 7 }, (_, index) =>
          new Intl.DateTimeFormat(locale, {
            weekday: "narrow",
            timeZone: "UTC",
          }).format(parseDate(addDays(gridStart, index))),
        ).map((label, index) => (
          <span key={`${label}-${index}`} className="py-1">
            {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {days.map((day) => {
          const value = parseDate(day);
          const muted = value.getUTCMonth() !== current.getUTCMonth();
          return (
            <button
              type="button"
              key={day}
              onClick={() => onSelect(day)}
              className={cn(
                "grid aspect-square place-items-center rounded-md text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                muted && "text-muted-foreground/45",
                day === date && "bg-foreground text-background hover:bg-foreground",
                day === today && day !== date && "font-bold text-[#6D5EF7]",
              )}
              aria-label={day}
            >
              {value.getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SourceIcon({ kind }: { kind: CalendarItem["kind"] }) {
  if (kind === "deadline") return <AlarmClock className="size-3.5" />;
  if (kind === "focus") return <Focus className="size-3.5" />;
  if (kind === "project") return <BriefcaseBusiness className="size-3.5" />;
  if (kind === "task" || kind === "milestone") {
    return <Check className="size-3.5" />;
  }
  return <CalendarDays className="size-3.5" />;
}

export function CalendarClient({
  currentUser,
  workspace,
  view,
  date,
  range,
  initialFilters,
  openNewEvent: shouldOpenNewEvent = false,
}: {
  currentUser: { id: string; name: string };
  workspace: CalendarWorkspace;
  view: CalendarView;
  date: string;
  range: { from: string; to: string };
  initialFilters: FilterState;
  openNewEvent?: boolean;
}) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [eventOpen, setEventOpen] = useState(shouldOpenNewEvent);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft>({
    name: "",
    color: "#6D5EF7",
    visibility: "private",
  });
  const importFileInput = useRef<HTMLInputElement>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<{
    label: string;
    fields: string[];
  } | null>(null);
  const [draft, setDraft] = useState<EventDraft>(() =>
    blankDraft(
      workspace.calendars[0]?.id ?? "",
      workspace.preferences.timezone,
      date,
    ),
  );
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [conflicts, setConflicts] = useState<
    { id: string; title: string; startAt: string; endAt: string }[]
  >([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const clientToday = useSyncExternalStore(
    subscribeToClock,
    () => localDate(),
    () => null,
  );
  const visibleSources = useMemo(
    () =>
      filters.sources.length > 0
        ? new Set(filters.sources)
        : new Set<string>(SOURCE_TYPES),
    [filters.sources],
  );
  const filteredItems = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase();
    return workspace.items.filter((item) => {
      if (!visibleSources.has(typeSource(item))) return false;
      if (
        filters.calendars.length > 0 &&
        item.calendarId &&
        !filters.calendars.includes(item.calendarId)
      ) {
        return false;
      }
      if (
        filters.people.length > 0 &&
        !filters.people.some(
          (person) =>
            item.assigneeId === person || item.attendeeIds.includes(person),
        )
      ) {
        return false;
      }
      if (
        filters.projects.length > 0 &&
        (!item.projectId || !filters.projects.includes(item.projectId))
      ) {
        return false;
      }
      if (
        query &&
        !`${item.title} ${item.description} ${item.location}`
          .toLocaleLowerCase()
          .includes(query)
      ) {
        return false;
      }
      return true;
    });
  }, [filters, visibleSources, workspace.items]);

  const days = useMemo(
    () => dateRange(range.from, range.to),
    [range.from, range.to],
  );
  const weekDays = days.slice(0, 7);
  const defaultCalendarId = workspace.calendars.find(
    (calendar) => calendar.role === "owner" || calendar.role === "editor",
  )?.id;
  const sourceColors = useMemo(() => {
    const fallback = {
      event: workspace.calendars[0]?.color ?? "#0284C7",
      focus: "#6D5EF7",
      deadline: "#D97706",
      task: workspace.projects[0]?.color ?? "#059669",
      project: workspace.projects[0]?.color ?? "#059669",
    } as const;
    return Object.fromEntries(
      SOURCE_TYPES.map((source) => [
        source,
        workspace.items.find((item) => typeSource(item) === source)?.color ??
          fallback[source],
      ]),
    ) as Record<(typeof SOURCE_TYPES)[number], string>;
  }, [workspace.calendars, workspace.items, workspace.projects]);

  useEffect(() => {
    let active = true;
    async function checkReminders() {
      try {
        const reminders = await claimDueCalendarReminders();
        if (!active) return;
        for (const reminder of reminders) {
          toast(reminder.title, {
            description: t("inAppReminder", {
              time: new Intl.DateTimeFormat(locale, {
                timeStyle: "short",
              }).format(new Date(reminder.startAt)),
            }),
            icon: <AlarmClock className="size-4 text-[#D97706]" />,
          });
        }
      } catch {
        // Reminder polling should never interrupt calendar work.
      }
    }
    void checkReminders();
    const timer = window.setInterval(checkReminders, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [locale, t]);

  function buildUrl(next: {
    view?: CalendarView;
    date?: string;
    filters?: FilterState;
  }) {
    const params = new URLSearchParams();
    params.set("view", next.view ?? view);
    params.set("date", next.date ?? date);
    const values = next.filters ?? filters;
    if (values.sources.length > 0) params.set("sources", values.sources.join(","));
    if (values.people.length > 0) params.set("people", values.people.join(","));
    if (values.projects.length > 0)
      params.set("projects", values.projects.join(","));
    if (values.calendars.length > 0)
      params.set("calendars", values.calendars.join(","));
    if (values.query) params.set("query", values.query);
    return `/calendar?${params.toString()}`;
  }

  function navigate(next: {
    view?: CalendarView;
    date?: string;
    filters?: FilterState;
  }) {
    router.push(buildUrl(next));
  }

  function closeEventDialog() {
    setEventOpen(false);
    if (shouldOpenNewEvent) router.replace(buildUrl({}));
  }

  function resetImport() {
    setImportUrl("");
    setImportBusy(false);
    setImportError("");
    setImportResult(null);
  }

  function applyImportSuggestion(
    suggestion: CalendarImportSuggestion,
    label: string,
  ) {
    const next = { ...draft };
    const fields: string[] = [];
    if (suggestion.title && !next.title.trim()) {
      next.title = suggestion.title;
      fields.push("title");
    }
    if (suggestion.location && !next.location.trim()) {
      next.location = suggestion.location;
      fields.push("location");
    }
    if (suggestion.description && !next.description.trim()) {
      next.description = suggestion.description;
      fields.push("description");
    }
    if (suggestion.startDate) {
      next.startDate = suggestion.startDate;
      fields.push("date");
    }
    if (suggestion.allDay !== undefined) {
      next.allDay = suggestion.allDay;
    }
    if (suggestion.startTime) {
      next.startTime = suggestion.startTime;
      fields.push("startTime");
    }
    if (suggestion.endTime) {
      next.endTime = suggestion.endTime;
      fields.push("endTime");
    }
    if (suggestion.endDate && suggestion.allDay) {
      next.endDate = suggestion.endDate;
      fields.push("endDate");
    } else if (suggestion.startDate && suggestion.allDay) {
      next.endDate = addDays(suggestion.startDate, 1);
    }
    if (suggestion.timezone) {
      next.timezone = suggestion.timezone;
      fields.push("timezone");
    }
    if (suggestion.repeat && suggestion.repeat !== "none") {
      next.repeat = suggestion.repeat;
      fields.push("repeat");
    }
    setDraft(next);
    setImportError("");
    setImportResult({ label, fields: [...new Set(fields)] });
  }

  function importErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message === "file_too_large") return t("importFileTooLarge");
    if (message === "unsupported_file") return t("importUnsupportedFile");
    return t("importFailed");
  }

  async function importFile(file: File) {
    setImportBusy(true);
    setImportError("");
    setImportResult(null);
    try {
      const text = await extractImportFileText(file);
      if (!text.trim()) throw new Error("unsupported_file");
      const suggestion = await analyzeCalendarText({
        text,
        fileName: file.name,
      });
      applyImportSuggestion(suggestion, file.name);
    } catch (error) {
      setImportError(importErrorMessage(error));
    } finally {
      setImportBusy(false);
    }
  }

  async function importFromUrl(value = importUrl) {
    const url = value.trim();
    if (!/^https?:\/\//i.test(url)) {
      setImportError(t("importInvalidUrl"));
      return;
    }
    setImportUrl(url);
    setImportBusy(true);
    setImportError("");
    setImportResult(null);
    try {
      const suggestion = await analyzeCalendarUrl({ url });
      applyImportSuggestion(suggestion, new URL(url).hostname);
    } catch (error) {
      setImportError(importErrorMessage(error));
    } finally {
      setImportBusy(false);
    }
  }

  function acceptImportTransfer(transfer: DataTransfer) {
    const file = transfer.files?.[0];
    if (file) {
      void importFile(file);
      return;
    }
    const url =
      transfer.getData("text/uri-list").split("\n").find(Boolean) ??
      transfer.getData("text/plain");
    if (url) void importFromUrl(url);
  }

  function updateFilters(next: FilterState) {
    setFilters(next);
    router.replace(buildUrl({ filters: next }));
  }

  function toggleFilter(
    group: "sources" | "people" | "projects" | "calendars",
    value: string,
  ) {
    const current =
      group === "sources" && filters.sources.length === 0
        ? [...SOURCE_TYPES]
        : filters[group];
    const values = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    updateFilters({ ...filters, [group]: values });
  }

  function movePeriod(direction: number) {
    const amount = view === "month" ? 28 : view === "agenda" ? 30 : 7;
    navigate({ date: addDays(date, amount * direction) });
  }

  function openNewEvent(day = date, hour = 9) {
    if (!defaultCalendarId) {
      toast.error("No editable calendar is available");
      return;
    }
    setConflicts([]);
    setDraft(
      blankDraft(
        defaultCalendarId,
        workspace.preferences.timezone,
        day,
        hour,
      ),
    );
    resetImport();
    setEventOpen(true);
  }

  function openNewCalendar() {
    setCalendarDraft({ name: "", color: "#6D5EF7", visibility: "private" });
    setCalendarOpen(true);
  }

  function openEditCalendar(calendar: CalendarWorkspace["calendars"][number]) {
    setCalendarDraft({
      id: calendar.id,
      name: calendar.name,
      color: calendar.color,
      visibility: calendar.visibility,
    });
    setCalendarOpen(true);
  }

  function submitCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => {
      void (calendarDraft.id
        ? updateCalendar({
            calendarId: calendarDraft.id,
            name: calendarDraft.name,
            color: calendarDraft.color,
            visibility: calendarDraft.visibility,
          })
        : createCalendar({
            name: calendarDraft.name,
            color: calendarDraft.color,
            visibility: calendarDraft.visibility,
          })
      )
        .then(() => {
          setCalendarOpen(false);
          router.refresh();
        })
        .catch(() => toast.error(t("calendarSaveError")));
    });
  }

  function openEditEvent(item: CalendarItem) {
    if (item.kind !== "event" && item.kind !== "focus") return;
    setConflicts([]);
    setDraft(
      itemDraft(
        item,
        defaultCalendarId ?? "",
        workspace.preferences.timezone,
      ),
    );
    resetImport();
    setEventOpen(true);
  }

  function recurrenceRule() {
    if (draft.repeat === "none") return null;
    return `FREQ=${draft.repeat.toUpperCase()}`;
  }

  async function saveEvent(allowConflicts = false) {
    const [startYear, startMonth, startDay] = draft.startDate
      .split("-")
      .map(Number);
    const [startHour, startMinute] = draft.startTime.split(":").map(Number);
    const startAt = draft.allDay
      ? null
      : zonedDateTimeToUtc(
          {
            year: startYear,
            month: startMonth,
            day: startDay,
            hour: startHour,
            minute: startMinute,
          },
          draft.timezone,
        ).toISOString();
    const timedEndDate =
      draft.endTime <= draft.startTime
        ? addDays(draft.startDate, 1)
        : draft.startDate;
    const [endYear, endMonth, endDay] = timedEndDate.split("-").map(Number);
    const [endHour, endMinute] = draft.endTime.split(":").map(Number);
    const endAt = draft.allDay
      ? null
      : zonedDateTimeToUtc(
          {
            year: endYear,
            month: endMonth,
            day: endDay,
            hour: endHour,
            minute: endMinute,
          },
          draft.timezone,
        ).toISOString();
    if (
      draft.id &&
      draft.recurring &&
      draft.scope === "occurrence" &&
      draft.occurrenceKey
    ) {
      await upsertCalendarOccurrence({
        eventId: draft.id,
        occurrenceKey: draft.occurrenceKey,
        cancelled: false,
        override: draft.allDay
          ? {
              title: draft.title,
              description: draft.description,
              startDate: draft.startDate,
              endDate: draft.endDate,
            }
          : {
              title: draft.title,
              description: draft.description,
              startAt: startAt!,
              endAt: endAt!,
            },
      });
      closeEventDialog();
      router.refresh();
      toast.success(t("eventSaved"));
      return;
    }
    const eventInput = {
      id: draft.id,
      calendarId: draft.calendarId,
      kind: draft.kind,
      title: draft.title,
      description: draft.description,
      location: draft.location,
      allDay: draft.allDay,
      startDate: draft.allDay ? draft.startDate : null,
      endDate: draft.allDay ? draft.endDate : null,
      startAt,
      endAt,
      timezone: draft.timezone,
      availability: draft.availability,
      recurrenceRule: recurrenceRule(),
      linkedTaskId: null,
      attendeeIds: draft.attendeeIds,
      reminderMinutes:
        draft.reminderMinutes === null ? [] : [draft.reminderMinutes],
      expectedUpdatedAt: draft.expectedUpdatedAt,
      allowConflicts,
    };
    const result =
      draft.id &&
      draft.recurring &&
      draft.scope === "future" &&
      draft.occurrenceKey
        ? await splitCalendarEventSeries({
            event: eventInput,
            occurrenceKey: draft.occurrenceKey,
          })
        : await upsertCalendarEvent(eventInput);
    if (result.status === "conflict") {
      setConflicts(result.conflicts);
      return;
    }
    closeEventDialog();
    router.refresh();
    toast.success(t("eventSaved"));
  }

  function submitEvent(event: FormEvent) {
    event.preventDefault();
    startTransition(() => {
      void saveEvent().catch(() => toast.error(t("conflictDescription")));
    });
  }

  function removeEvent() {
    if (!draft.id) return;
    startTransition(() => {
      void (async () => {
        if (
          draft.recurring &&
          draft.scope === "occurrence" &&
          draft.occurrenceKey
        ) {
          await upsertCalendarOccurrence({
            eventId: draft.id!,
            occurrenceKey: draft.occurrenceKey,
            cancelled: true,
            override: {},
          });
        } else if (
          draft.recurring &&
          draft.scope === "future" &&
          draft.occurrenceKey &&
          draft.expectedUpdatedAt
        ) {
          await truncateCalendarEventSeries({
            eventId: draft.id!,
            occurrenceKey: draft.occurrenceKey,
            expectedUpdatedAt: draft.expectedUpdatedAt,
          });
        } else {
          await deleteCalendarEvent(draft.id!);
        }
        closeEventDialog();
        setSelected(null);
        router.refresh();
        toast.success(t("eventDeleted"));
      })().catch(() => toast.error(t("conflictDescription")));
    });
  }

  function dragPayload(event: DragEvent, payload: object) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-flow-calendar", JSON.stringify(payload));
  }

  function readDrag(event: DragEvent) {
    try {
      return JSON.parse(
        event.dataTransfer.getData("application/x-flow-calendar"),
      ) as { type: "item" | "task"; id: string };
    } catch {
      return null;
    }
  }

  async function moveProjectItem(item: CalendarItem, targetDate: string) {
    if (!item.startDate || !item.endDate) return;
    const duration = Math.max(1, daysBetween(item.startDate, item.endDate));
    const dueDate = addDays(targetDate, duration - 1);
    const entityType: "project" | "task" =
      item.kind === "project" ? "project" : "task";
    const edit = {
      entityType,
      entityId: item.sourceId,
      startDate: targetDate,
      dueDate,
      operation: "move" as const,
    };
    const preview = await previewPortfolioScheduleChange(edit);
    if (
      !window.confirm(
        t("scheduleImpact", { count: preview.changes.length }),
      )
    ) {
      return;
    }
    const result = await applyPortfolioScheduleChange({
      ...edit,
      expectedPreview: { changes: preview.changes },
    });
    router.refresh();
    toast.success(t("scheduleMoved"), {
      action: result.changeSetId
        ? {
            label: t("undo"),
            onClick: () => {
              void revertPortfolioScheduleChange(result.changeSetId!).then(() => {
                router.refresh();
                toast(t("scheduleMoved"), {
                  action: {
                    label: t("redo"),
                    onClick: () => {
                      void reapplyPortfolioScheduleChange(
                        result.changeSetId!,
                      ).then(() => router.refresh());
                    },
                  },
                });
              });
            },
          }
        : undefined,
    });
  }

  async function dropOnDay(event: DragEvent, targetDate: string) {
    event.preventDefault();
    const payload = readDrag(event);
    if (!payload) return;
    if (payload.type === "task") {
      openNewEvent(targetDate, 9);
      return;
    }
    const item = workspace.items.find((candidate) => candidate.id === payload.id);
    if (!item) return;
    try {
      if (item.kind === "project" || item.kind === "task" || item.kind === "milestone") {
        if (item.projectId || item.kind === "project") {
          await moveProjectItem(item, targetDate);
        }
      } else if (item.kind === "deadline" && item.allDay) {
        await moveContextualDeadline({
          id: item.sourceId,
          deadlineDate: targetDate,
          deadlineAt: null,
          expectedUpdatedAt: item.updatedAt,
        });
        router.refresh();
      } else if ((item.kind === "event" || item.kind === "focus") && item.allDay) {
        const duration = Math.max(
          1,
          daysBetween(item.startDate!, item.endDate!),
        );
        await moveCalendarEvent({
          id: item.sourceId,
          startDate: targetDate,
          endDate: addDays(targetDate, duration),
          expectedUpdatedAt: item.updatedAt,
        });
        router.refresh();
      }
    } catch {
      toast.error(t("conflictDescription"));
    } finally {
      setDraggingId(null);
    }
  }

  async function dropOnTime(event: DragEvent, targetDate: string, hour: number) {
    event.preventDefault();
    const payload = readDrag(event);
    if (!payload || !defaultCalendarId) return;
    const start = new Date(`${targetDate}T${String(hour).padStart(2, "0")}:00`);
    const end = new Date(start.getTime() + 60 * 60_000);
    try {
      if (payload.type === "task") {
        const result = await createTaskFocusBlock({
          taskId: payload.id,
          calendarId: defaultCalendarId,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          timezone: workspace.preferences.timezone,
        });
        if (result.status === "conflict") {
          toast.error(t("conflictTitle"));
        } else {
          toast.success(t("focusCreated"));
          router.refresh();
        }
        return;
      }
      const item = workspace.items.find((candidate) => candidate.id === payload.id);
      if (!item) return;
      if (item.kind === "task" && !item.allDay) return;
      if (item.kind === "task" || item.kind === "milestone") {
        const result = await createTaskFocusBlock({
          taskId: item.sourceId,
          calendarId: defaultCalendarId,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          timezone: workspace.preferences.timezone,
        });
        if (result.status === "saved") router.refresh();
        return;
      }
      if ((item.kind === "event" || item.kind === "focus") && item.startAt && item.endAt) {
        const duration =
          new Date(item.endAt).getTime() - new Date(item.startAt).getTime();
        const result = await moveCalendarEvent({
          id: item.sourceId,
          startAt: start.toISOString(),
          endAt: new Date(start.getTime() + duration).toISOString(),
          expectedUpdatedAt: item.updatedAt,
        });
        if (result.status === "conflict") {
          if (window.confirm(t("conflictDescription"))) {
            await moveCalendarEvent({
              id: item.sourceId,
              startAt: start.toISOString(),
              endAt: new Date(start.getTime() + duration).toISOString(),
              expectedUpdatedAt: item.updatedAt,
              allowConflicts: true,
            });
          }
        }
        router.refresh();
      }
    } catch {
      toast.error(t("conflictDescription"));
    } finally {
      setDraggingId(null);
    }
  }

  async function saveView() {
    const name = window.prompt(t("viewName"));
    if (!name) return;
    await saveCalendarView({ name, view, filters });
    router.refresh();
    toast.success(t("viewSaved"));
  }

  const periodLabel =
    view === "month"
      ? new Intl.DateTimeFormat(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(parseDate(date))
      : `${new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(parseDate(range.from))} – ${new Intl.DateTimeFormat(locale, {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }).format(parseDate(addDays(range.to, -1)))}`;
  const periodActionLabel =
    view === "week"
      ? t("calendarWeek", { week: isoWeekNumber(range.from) })
      : view === "month"
        ? periodLabel
        : t(view);
  const importFieldLabels: Record<string, string> = {
    title: t("eventTitle"),
    location: t("location"),
    description: t("descriptionLabel"),
    date: t("start"),
    startTime: t("start"),
    endTime: t("end"),
    endDate: t("end"),
    timezone: t("timezone"),
    repeat: t("repeat"),
  };

  return (
    <div className="mx-auto flex w-full max-w-[112rem] flex-col gap-4">
      <header className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("eyebrow")}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <span className="font-mono text-sm text-muted-foreground">
              {periodLabel}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("previous")}
              onClick={() => movePeriod(-1)}
            >
              <ArrowLeft />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ date: localDate() })}
            >
              {periodActionLabel}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("next")}
              onClick={() => movePeriod(1)}
            >
              <ArrowRight />
            </Button>
          </div>
          <div className="flex items-center rounded-lg border bg-background p-0.5">
            {(["week", "month", "agenda", "team"] as const).map((mode) => (
              <Button
                key={mode}
                variant={view === mode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => navigate({ view: mode })}
                className="hidden sm:inline-flex"
              >
                {t(mode)}
              </Button>
            ))}
          </div>
          <Button onClick={() => openNewEvent()} disabled={!defaultCalendarId}>
            <Plus />
            {t("newEvent")}
          </Button>
        </div>
      </header>

      <div className="grid min-h-[44rem] gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] 2xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <aside className="hidden rounded-2xl border bg-card p-4 lg:flex lg:flex-col lg:gap-5">
          <MiniMonth
            date={date}
            today={clientToday}
            locale={locale}
            onSelect={(nextDate) => navigate({ date: nextDate })}
          />
          <div className="border-t pt-4">
            <label className="relative block">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.query}
                onChange={(event) =>
                  updateFilters({ ...filters, query: event.target.value })
                }
                placeholder={t("searchPlaceholder")}
                className="pl-8"
              />
            </label>
          </div>
          <FilterGroup title={t("workSources")}>
            {SOURCE_TYPES.map((source) => (
              <FilterToggle
                key={source}
                checked={visibleSources.has(source)}
                label={
                  source === "event"
                    ? t("events")
                    : source === "focus"
                      ? t("focus")
                      : source === "deadline"
                        ? t("deadlines")
                        : source === "task"
                          ? t("tasks")
                          : t("projects")
                }
                color={sourceColors[source]}
                onChange={() => toggleFilter("sources", source)}
              />
            ))}
          </FilterGroup>
          <FilterGroup title={t("calendars")}>
            {workspace.calendars.map((calendar) => {
              const checked =
                filters.calendars.length === 0 ||
                filters.calendars.includes(calendar.id);
              return (
                <div key={calendar.id} className="flex items-center gap-1">
                  <FilterToggle
                    checked={checked}
                    label={calendar.name}
                    color={calendar.color}
                    onChange={() => toggleFilter("calendars", calendar.id)}
                    detail={
                      calendar.visibility === "private"
                        ? t("calendarPrivate")
                        : calendar.visibility === "busy"
                          ? t("calendarBusyOnly")
                          : t("calendarShared")
                    }
                  />
                  {calendar.role === "owner" && (
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={t("editCalendar")}
                      onClick={() => openEditCalendar(calendar)}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={openNewCalendar}
            >
              <Plus className="size-3.5" />
              {t("addCalendar")}
            </button>
          </FilterGroup>
          <FilterGroup title={t("people")}>
            {workspace.members.map((member) => (
              <FilterToggle
                key={member.id}
                checked={filters.people.includes(member.id)}
                label={member.id === currentUser.id ? `${member.name} · me` : member.name}
                color="#6D5EF7"
                onChange={() => toggleFilter("people", member.id)}
              />
            ))}
          </FilterGroup>
          {workspace.savedViews.length > 0 && (
            <FilterGroup title={t("savedViews")}>
              {workspace.savedViews.map((saved) => (
                <button
                  type="button"
                  key={saved.id}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                  onClick={() => {
                    setFilters({
                      sources: saved.filters.sources ?? [],
                      people: saved.filters.people ?? [],
                      projects: saved.filters.projects ?? [],
                      calendars: saved.filters.calendars ?? [],
                      query: saved.filters.query ?? "",
                    });
                    navigate({
                      view: saved.view,
                      filters: {
                        sources: saved.filters.sources ?? [],
                        people: saved.filters.people ?? [],
                        projects: saved.filters.projects ?? [],
                        calendars: saved.filters.calendars ?? [],
                        query: saved.filters.query ?? "",
                      },
                    });
                  }}
                >
                  <span className="truncate">{saved.name}</span>
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                </button>
              ))}
            </FilterGroup>
          )}
          <Button
            variant="outline"
            size="sm"
            className="mt-auto w-full"
            onClick={() => void saveView()}
          >
            <Sparkles />
            {t("saveView")}
          </Button>
        </aside>

        <main className="min-w-0 rounded-2xl border bg-card">
          {view === "week" && (
            <FlowWeek
              days={weekDays}
              today={clientToday}
              items={filteredItems}
              draggingId={draggingId}
              locale={locale}
              t={t}
              preferences={workspace.preferences}
              onSelect={setSelected}
              onEdit={openEditEvent}
              onNew={openNewEvent}
              onDragStart={(event, item) => {
                setDraggingId(item.id);
                dragPayload(event, { type: "item", id: item.id });
              }}
              onDropDay={(event, day) => void dropOnDay(event, day)}
              onDropTime={(event, day, hour) =>
                void dropOnTime(event, day, hour)
              }
            />
          )}
          {view === "month" && (
            <MonthView
              days={days}
              date={date}
              today={clientToday}
              items={filteredItems}
              locale={locale}
              t={t}
              onSelect={setSelected}
              onNew={openNewEvent}
              onDrop={(event, day) => void dropOnDay(event, day)}
              onDragStart={(event, item) => {
                setDraggingId(item.id);
                dragPayload(event, { type: "item", id: item.id });
              }}
            />
          )}
          {view === "agenda" && (
            <AgendaView
              days={days}
              items={filteredItems}
              locale={locale}
              t={t}
              onSelect={setSelected}
            />
          )}
          {view === "team" && (
            <TeamView
              days={weekDays}
              items={filteredItems}
              members={workspace.members}
              locale={locale}
              t={t}
              onSelect={setSelected}
            />
          )}
        </main>

        <aside className="hidden min-w-0 2xl:block">
          {selected ? (
            <Inspector
              item={selected}
              locale={locale}
              t={t}
              onClose={() => setSelected(null)}
              onEdit={() => openEditEvent(selected)}
            />
          ) : (
            <UnscheduledTray
              tasks={workspace.unscheduledTasks}
              t={t}
              onDragStart={(event, id) => {
                setDraggingId(`task:${id}`);
                dragPayload(event, { type: "task", id });
              }}
            />
          )}
        </aside>
      </div>

      <Dialog
        open={eventOpen}
        onOpenChange={(open) => {
          if (open) setEventOpen(true);
          else closeEventDialog();
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={submitEvent}>
            <DialogHeader>
              <DialogTitle>{draft.id ? t("editEvent") : t("newEvent")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid gap-4">
              {draft.recurring && (
                <div className="flex rounded-lg border bg-muted/35 p-1">
                  {(["occurrence", "future", "series"] as const).map((scope) => (
                    <button
                      type="button"
                      key={scope}
                      onClick={() => setDraft({ ...draft, scope })}
                      className={cn(
                        "flex-1 rounded-md px-3 py-1.5 text-xs font-medium",
                        draft.scope === scope && "bg-background shadow-sm",
                      )}
                    >
                      {scope === "occurrence"
                        ? t("thisOccurrence")
                        : scope === "future"
                          ? t("thisAndFuture")
                          : t("entireSeries")}
                    </button>
                  ))}
                </div>
              )}
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t("eventTitle")}</span>
                <Input
                  autoFocus
                  required
                  value={draft.title}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                  placeholder={t("eventTitlePlaceholder")}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">{t("calendarLabel")}</span>
                  <select
                    className="h-8 rounded-lg border bg-background px-2.5 text-sm"
                    value={draft.calendarId}
                    onChange={(event) =>
                      setDraft({ ...draft, calendarId: event.target.value })
                    }
                  >
                    {workspace.calendars
                      .filter(
                        (calendar) =>
                          calendar.role === "owner" || calendar.role === "editor",
                      )
                      .map((calendar) => (
                        <option value={calendar.id} key={calendar.id}>
                          {calendar.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">{t("location")}</span>
                  <Input
                    value={draft.location}
                    onChange={(event) =>
                      setDraft({ ...draft, location: event.target.value })
                    }
                    placeholder="Room, address or link"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.allDay}
                  onChange={(event) =>
                    setDraft({ ...draft, allDay: event.target.checked })
                  }
                  className="size-4 accent-foreground"
                />
                {t("allDay")}
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">{t("start")}</span>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      required
                      value={draft.startDate}
                      onChange={(event) =>
                        setDraft({ ...draft, startDate: event.target.value })
                      }
                    />
                    {!draft.allDay && (
                      <Input
                        type="time"
                        required
                        value={draft.startTime}
                        onChange={(event) =>
                          setDraft({ ...draft, startTime: event.target.value })
                        }
                        className="w-28 font-mono"
                      />
                    )}
                  </div>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">{t("end")}</span>
                  <div className="flex gap-2">
                    {draft.allDay && (
                      <Input
                        type="date"
                        required
                        value={draft.endDate}
                        min={addDays(draft.startDate, 1)}
                        onChange={(event) =>
                          setDraft({ ...draft, endDate: event.target.value })
                        }
                      />
                    )}
                    {!draft.allDay && (
                      <Input
                        type="time"
                        required
                        value={draft.endTime}
                        onChange={(event) =>
                          setDraft({ ...draft, endTime: event.target.value })
                        }
                        className="w-28 font-mono"
                      />
                    )}
                  </div>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">{t("repeat")}</span>
                  <select
                    className="h-8 rounded-lg border bg-background px-2.5 text-sm"
                    value={draft.repeat}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        repeat: event.target.value as EventDraft["repeat"],
                      })
                    }
                  >
                    <option value="none">{t("repeatNone")}</option>
                    <option value="daily">{t("repeatDaily")}</option>
                    <option value="weekly">{t("repeatWeekly")}</option>
                    <option value="monthly">{t("repeatMonthly")}</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">{t("availability")}</span>
                  <select
                    className="h-8 rounded-lg border bg-background px-2.5 text-sm"
                    value={draft.availability}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        availability: event.target.value as "busy" | "free",
                      })
                    }
                  >
                    <option value="busy">{t("busy")}</option>
                    <option value="free">{t("free")}</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium">{t("reminder")}</span>
                  <select
                    className="h-8 rounded-lg border bg-background px-2.5 text-sm"
                    value={draft.reminderMinutes ?? "none"}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        reminderMinutes:
                          event.target.value === "none"
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  >
                    <option value="none">{t("noReminder")}</option>
                    <option value="5">{t("fiveMinutes")}</option>
                    <option value="15">{t("fifteenMinutes")}</option>
                    <option value="60">{t("oneHour")}</option>
                  </select>
                </label>
              </div>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t("timezone")}</span>
                <Input
                  value={draft.timezone}
                  onChange={(event) =>
                    setDraft({ ...draft, timezone: event.target.value })
                  }
                  className="font-mono text-xs"
                />
              </label>
              <fieldset className="grid gap-2">
                <legend className="text-xs font-medium">{t("attendees")}</legend>
                <div className="flex flex-wrap gap-2">
                  {workspace.members
                    .filter((member) => member.id !== currentUser.id)
                    .map((member) => {
                      const checked = draft.attendeeIds.includes(member.id);
                      return (
                        <label
                          key={member.id}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
                            checked && "border-[#6D5EF7]/45 bg-[#6D5EF7]/10",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setDraft({
                                ...draft,
                                attendeeIds: checked
                                  ? draft.attendeeIds.filter(
                                      (id) => id !== member.id,
                                    )
                                  : [...draft.attendeeIds, member.id],
                              })
                            }
                            className="sr-only"
                          />
                          <UserRound className="size-3.5" />
                          {member.name}
                        </label>
                      );
                    })}
                </div>
              </fieldset>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium">{t("descriptionLabel")}</span>
                <Textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  rows={3}
                />
              </label>
              <section
                className={cn(
                  "rounded-xl border border-dashed bg-muted/15 p-3 transition-colors",
                  importBusy
                    ? "border-[#6D5EF7]/60 bg-[#6D5EF7]/5"
                    : "border-border hover:border-[#6D5EF7]/40",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  acceptImportTransfer(event.dataTransfer);
                }}
                onPaste={(event) => {
                  const file = event.clipboardData.files?.[0];
                  if (file) {
                    event.preventDefault();
                    void importFile(file);
                    return;
                  }
                  const value = event.clipboardData.getData("text/plain");
                  if (/^https?:\/\//i.test(value.trim())) {
                    event.preventDefault();
                    void importFromUrl(value);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-background text-[#6D5EF7]">
                    {importBusy ? (
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <FileUp className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{t("importTitle")}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("importDescription")}
                    </p>
                  </div>
                  <input
                    ref={importFileInput}
                    type="file"
                    accept=".ics,.txt,.md,.csv,.json,.pdf,text/calendar,text/plain,application/pdf"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void importFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={importBusy}
                    onClick={() => importFileInput.current?.click()}
                  >
                    {t("chooseFile")}
                  </Button>
                </div>
                <div className="mt-3 flex gap-2">
                  <label className="relative min-w-0 flex-1">
                    <Link2 className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="url"
                      value={importUrl}
                      disabled={importBusy}
                      placeholder={t("importUrlPlaceholder")}
                      className="pl-8"
                      onChange={(event) => setImportUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void importFromUrl();
                        }
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={importBusy || !importUrl.trim()}
                    onClick={() => void importFromUrl()}
                  >
                    {t("analyze")}
                  </Button>
                </div>
                <div className="mt-2 min-h-5" aria-live="polite">
                  {importBusy && (
                    <p className="text-xs text-muted-foreground">
                      {t("importAnalyzing")}
                    </p>
                  )}
                  {importError && (
                    <p className="text-xs font-medium text-destructive">
                      {importError}
                    </p>
                  )}
                  {importResult && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Check className="size-3.5 text-[#059669]" />
                      <span className="font-medium">{importResult.label}</span>
                      {importResult.fields.length > 0 ? (
                        importResult.fields.map((field) => (
                          <span
                            key={field}
                            className="rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {importFieldLabels[field]}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground">
                          {t("importNoNewFields")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </section>
              {conflicts.length > 0 && (
                <div className="rounded-xl border border-[#E11D48]/30 bg-[#E11D48]/5 p-3">
                  <div className="flex gap-2">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#E11D48]" />
                    <div>
                      <p className="text-sm font-semibold">{t("conflictTitle")}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("conflictDescription")}
                      </p>
                      <ul className="mt-2 space-y-1 text-xs">
                        {conflicts.map((conflict) => (
                          <li key={conflict.id}>
                            {conflict.title} ·{" "}
                            {new Intl.DateTimeFormat(locale, {
                              timeStyle: "short",
                            }).format(new Date(conflict.startAt))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="mt-5">
              {draft.id && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={removeEvent}
                  disabled={pending}
                  className="sm:mr-auto"
                >
                  <Trash2 />
                  {t("deleteEvent")}
                </Button>
              )}
              {conflicts.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    startTransition(() => {
                      void saveEvent(true).catch(() =>
                        toast.error(t("conflictDescription")),
                      );
                    })
                  }
                  disabled={pending}
                >
                  {t("saveAnyway")}
                </Button>
              )}
              <Button type="submit" disabled={pending}>
                {t("saveEvent")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <CalendarSettingsDialog
        open={calendarOpen}
        onOpenChange={setCalendarOpen}
        draft={calendarDraft}
        setDraft={setCalendarDraft}
        onSubmit={submitCalendar}
        pending={pending}
        t={t}
      />
    </div>
  );
}

function CalendarSettingsDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  onSubmit,
  pending,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: CalendarDraft;
  setDraft: (draft: CalendarDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  t: ReturnType<typeof useTranslations<"calendar">>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{draft.id ? t("editCalendar") : t("addCalendar")}</DialogTitle>
            <DialogDescription>{t("calendarVisibilityDescription")}</DialogDescription>
          </DialogHeader>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium">{t("calendarName")}</span>
              <Input
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={t("calendarNamePlaceholder")}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium">{t("calendarColor")}</span>
              <Input
                type="color"
                value={draft.color}
                onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                className="h-9 w-20 p-1"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium">{t("calendarVisibility")}</span>
              <select
                className="h-9 rounded-lg border bg-background px-2.5 text-sm"
                value={draft.visibility}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    visibility: event.target.value as CalendarDraft["visibility"],
                  })
                }
              >
                <option value="private">{t("calendarPrivate")}</option>
                <option value="busy">{t("calendarBusyOnly")}</option>
                <option value="company">{t("calendarShared")}</option>
              </select>
            </label>
          </div>
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("saveCalendar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function FilterToggle({
  checked,
  label,
  color,
  onChange,
  detail,
}: {
  checked: boolean;
  label: string;
  color: string;
  onChange: () => void;
  detail?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        className={cn(
          "grid size-3.5 place-items-center rounded-[4px] border",
          checked && "text-white",
        )}
        style={{
          borderColor: color,
          backgroundColor: checked ? color : "transparent",
        }}
      >
        {checked && <Check className="size-2.5" />}
      </span>
      <span className="min-w-0 truncate">
        <span className="block truncate">{label}</span>
        {detail && (
          <span className="block truncate text-[10px] text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </label>
  );
}

function FlowWeek({
  days,
  today,
  items,
  draggingId,
  locale,
  t,
  preferences,
  onSelect,
  onEdit,
  onNew,
  onDragStart,
  onDropDay,
  onDropTime,
}: {
  days: string[];
  today: string | null;
  items: CalendarItem[];
  draggingId: string | null;
  locale: string;
  t: ReturnType<typeof useTranslations<"calendar">>;
  preferences: CalendarWorkspace["preferences"];
  onSelect: (item: CalendarItem) => void;
  onEdit: (item: CalendarItem) => void;
  onNew: (day: string, hour?: number) => void;
  onDragStart: (event: DragEvent, item: CalendarItem) => void;
  onDropDay: (event: DragEvent, day: string) => void;
  onDropTime: (event: DragEvent, day: string, hour: number) => void;
}) {
  const allDayByDate = new Map(
    days.map((day) => [
      day,
      items.filter(
        (item) =>
          item.allDay &&
          item.startDate &&
          item.endDate &&
          item.startDate <= day &&
          item.endDate > day,
      ),
    ]),
  );
  const timedByDate = new Map(
    days.map((day) => [
      day,
      items.filter((item) => !item.allDay && dateForTimedItem(item) === day),
    ]),
  );
  const workMinutes =
    (Number(preferences.workingDayEnd.slice(0, 2)) * 60 +
      Number(preferences.workingDayEnd.slice(3)) -
      (Number(preferences.workingDayStart.slice(0, 2)) * 60 +
        Number(preferences.workingDayStart.slice(3)))) ||
    540;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[52rem]">
      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(7rem,1fr))] border-b">
        <div className="flex items-center justify-center border-r p-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]">
            {t("load")}
          </span>
        </div>
        {days.map((day) => {
          const dayItems = timedByDate.get(day) ?? [];
          const busyMinutes = dayItems
            .filter((item) => item.availability === "busy")
            .reduce(
              (sum, item) =>
                sum + Math.max(0, endMinutes(item) - startMinutes(item)),
              0,
            );
          const focusMinutes = dayItems
            .filter((item) => item.kind === "focus")
            .reduce(
              (sum, item) =>
                sum + Math.max(0, endMinutes(item) - startMinutes(item)),
              0,
            );
          const conflicts = dayItems.reduce((count, item, index) => {
            const overlaps = dayItems
              .slice(index + 1)
              .some(
                (other) =>
                  startMinutes(item) < endMinutes(other) &&
                  endMinutes(item) > startMinutes(other),
              );
            return count + (overlaps ? 1 : 0);
          }, 0);
          const percent = Math.min(100, Math.round((busyMinutes / workMinutes) * 100));
          return (
            <div
              key={day}
              className={cn(
                "border-r p-2.5 last:border-r-0",
                day === today && "bg-[#6D5EF7]/[0.035]",
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {new Intl.DateTimeFormat(locale, {
                      weekday: "short",
                      timeZone: "UTC",
                    }).format(parseDate(day))}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-lg font-semibold",
                      day === today && "text-[#6D5EF7]",
                    )}
                  >
                    {parseDate(day).getUTCDate()}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {percent}%
                </span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                title={t("dayLoad", { percent })}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] motion-reduce:transition-none",
                    conflicts > 0
                      ? "bg-[#E11D48]"
                      : percent > 85
                        ? "bg-[#D97706]"
                        : "bg-[#059669]",
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-muted-foreground">
                <span>{t("focusMinutes", { minutes: focusMinutes })}</span>
                {conflicts > 0 && (
                  <span className="text-[#E11D48]">
                    {t("conflicts", { count: conflicts })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[3.5rem_repeat(7,minmax(7rem,1fr))] border-b bg-muted/[0.18]">
        <div className="border-r px-2 py-3 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]">
          {t("allDayLane")}
        </div>
        {days.map((day) => (
          <div
            key={day}
            className="min-h-24 border-r p-1.5 last:border-r-0"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDropDay(event, day)}
            onDoubleClick={() => onNew(day)}
            aria-label={t("dragMove", { date: day })}
          >
            <div className="space-y-1">
              {(allDayByDate.get(day) ?? []).slice(0, 4).map((item) => (
                <button
                  type="button"
                  draggable={item.editable}
                  key={item.id}
                  onDragStart={(event) => onDragStart(event, item)}
                  onClick={() => onSelect(item)}
                  className={cn(
                    "group flex w-full items-center gap-1.5 rounded-md border-l-[3px] bg-background px-1.5 py-1 text-left text-[10px] shadow-sm outline-none hover:ring-1 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring",
                    draggingId === item.id && "opacity-45",
                  )}
                  style={{ borderLeftColor: item.color }}
                  title={item.title}
                >
                  <SourceIcon kind={item.kind} />
                  <span className="truncate font-medium">{item.title}</span>
                </button>
              ))}
              {(allDayByDate.get(day)?.length ?? 0) > 4 && (
                <p className="px-1 text-[10px] text-muted-foreground">
                  {t("more", {
                    count: (allDayByDate.get(day)?.length ?? 0) - 4,
                  })}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="relative grid grid-cols-[3.5rem_repeat(7,minmax(7rem,1fr))]">
        <div className="border-r">
          {HOURS.map((hour) => (
            <div key={hour} className="h-[60px] border-b pr-2 text-right">
              <span className="-translate-y-2.5 inline-block font-mono text-[10px] text-muted-foreground">
                {formatMinutes(hour * 60)}
              </span>
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div
            key={day}
            className={cn(
              "relative border-r last:border-r-0",
              day === today && "bg-[#6D5EF7]/[0.025]",
            )}
          >
            {HOURS.map((hour) => (
              <button
                type="button"
                key={hour}
                className="block h-[60px] w-full border-b text-left outline-none hover:bg-muted/30 focus-visible:bg-muted/40"
                onDoubleClick={() => onNew(day, hour)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => onDropTime(event, day, hour)}
                aria-label={`${day} ${formatMinutes(hour * 60)}`}
              />
            ))}
            {(timedByDate.get(day) ?? []).map((item) => {
              const top = Math.max(
                0,
                (startMinutes(item) - HOURS[0] * 60) * PX_PER_MINUTE,
              );
              const height = Math.max(
                24,
                (endMinutes(item) - startMinutes(item)) * PX_PER_MINUTE,
              );
              if (top > HOURS.length * 60) return null;
              return (
                <button
                  type="button"
                  key={item.id}
                  draggable={item.editable}
                  onDragStart={(event) => onDragStart(event, item)}
                  onClick={() => onSelect(item)}
                  onDoubleClick={() => onEdit(item)}
                  className={cn(
                    "absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-[10px] shadow-sm outline-none transition-[opacity,box-shadow] hover:z-20 hover:shadow-md focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                    item.kind === "focus"
                      ? "bg-[#6D5EF7]/12"
                      : item.kind === "deadline"
                        ? "bg-[#D97706]/12"
                        : "bg-background",
                    draggingId === item.id && "opacity-45",
                  )}
                  style={{
                    top,
                    height,
                    borderLeftColor: item.color,
                  }}
                >
                  <span className="block truncate font-semibold">{item.title}</span>
                  <span className="mt-0.5 block font-mono text-[9px] text-muted-foreground">
                    {formatMinutes(startMinutes(item))}–{formatMinutes(endMinutes(item))}
                  </span>
                  {height > 48 && item.location && (
                    <span className="mt-1 flex items-center gap-1 truncate text-[9px] text-muted-foreground">
                      <MapPin className="size-2.5" />
                      {item.location}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

function MonthView({
  days,
  date,
  today,
  items,
  locale,
  t,
  onSelect,
  onNew,
  onDrop,
  onDragStart,
}: {
  days: string[];
  date: string;
  today: string | null;
  items: CalendarItem[];
  locale: string;
  t: ReturnType<typeof useTranslations<"calendar">>;
  onSelect: (item: CalendarItem) => void;
  onNew: (day: string) => void;
  onDrop: (event: DragEvent, day: string) => void;
  onDragStart: (event: DragEvent, item: CalendarItem) => void;
}) {
  const month = parseDate(date).getUTCMonth();
  const weekdayLabels = days.slice(0, 7).map((day) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "short",
      timeZone: "UTC",
    }).format(parseDate(day)),
  );
  return (
    <div className="overflow-x-auto">
      <div className="grid min-h-[44rem] min-w-[52rem] grid-cols-7">
      {weekdayLabels.map((label, index) => (
        <div
          key={`${label}-${index}`}
          className={cn(
            "border-b border-r bg-muted/[0.18] px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground",
            index === 6 && "border-r-0",
          )}
        >
          {label}
        </div>
      ))}
      {days.map((day) => {
        const value = parseDate(day);
        const dayItems = items.filter((item) =>
          item.allDay
            ? Boolean(item.startDate && item.endDate && item.startDate <= day && item.endDate > day)
            : dateForTimedItem(item) === day,
        );
        return (
          <div
            key={day}
            className={cn(
              "min-h-28 border-b border-r p-2 last:border-r-0",
              value.getUTCMonth() !== month && "bg-muted/20 text-muted-foreground",
              day === today && "bg-[#6D5EF7]/[0.08] ring-1 ring-inset ring-[#6D5EF7]/45",
            )}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(event, day)}
            onDoubleClick={() => onNew(day)}
          >
            <div className="mb-2 flex items-center justify-between">
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full text-xs font-semibold",
                  day === today && "bg-[#6D5EF7] text-white shadow-sm",
                )}
              >
                {value.getUTCDate()}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">
                {t("monthSummary", { count: dayItems.length })}
              </span>
            </div>
            <div className="space-y-1">
              {dayItems.slice(0, 3).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  draggable={item.editable}
                  onDragStart={(event) => onDragStart(event, item)}
                  onClick={() => onSelect(item)}
                  className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[10px] hover:bg-muted"
                  style={{
                    boxShadow: `inset 2px 0 0 ${item.color}`,
                  }}
                >
                  {!item.allDay && (
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {new Intl.DateTimeFormat(locale, {
                        timeStyle: "short",
                      }).format(new Date(item.startAt!))}
                    </span>
                  )}
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

function AgendaView({
  days,
  items,
  locale,
  t,
  onSelect,
}: {
  days: string[];
  items: CalendarItem[];
  locale: string;
  t: ReturnType<typeof useTranslations<"calendar">>;
  onSelect: (item: CalendarItem) => void;
}) {
  const groups = days
    .map((day) => ({
      day,
      items: items.filter((item) =>
        item.allDay
          ? Boolean(item.startDate && item.endDate && item.startDate <= day && item.endDate > day)
          : dateForTimedItem(item) === day,
      ),
    }))
    .filter((group) => group.items.length > 0);
  if (groups.length === 0) {
    return (
      <div className="grid min-h-[32rem] place-items-center p-8 text-center">
        <div>
          <CalendarDays className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="divide-y">
      {groups.map((group) => (
        <section
          key={group.day}
          className="grid gap-3 p-4 sm:grid-cols-[8rem_minmax(0,1fr)]"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {new Intl.DateTimeFormat(locale, {
                weekday: "long",
                timeZone: "UTC",
              }).format(parseDate(group.day))}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {new Intl.DateTimeFormat(locale, {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              }).format(parseDate(group.day))}
            </p>
          </div>
          <div className="space-y-2">
            {group.items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onSelect(item)}
                className="flex w-full items-center gap-3 rounded-xl border bg-background p-3 text-left hover:bg-muted/35"
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-white"
                  style={{ backgroundColor: item.color }}
                >
                  <SourceIcon kind={item.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {item.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {item.allDay
                      ? t("allDay")
                      : new Intl.DateTimeFormat(locale, {
                          timeStyle: "short",
                        }).format(new Date(item.startAt!))}
                    {item.location ? ` · ${item.location}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TeamView({
  days,
  items,
  members,
  locale,
  t,
  onSelect,
}: {
  days: string[];
  items: CalendarItem[];
  members: CalendarWorkspace["members"];
  locale: string;
  t: ReturnType<typeof useTranslations<"calendar">>;
  onSelect: (item: CalendarItem) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[52rem]">
      <div className="grid grid-cols-[12rem_repeat(7,minmax(7rem,1fr))] border-b bg-muted/20">
        <div className="border-r p-3 text-xs font-semibold">{t("people")}</div>
        {days.map((day) => (
          <div key={day} className="border-r p-3 text-center last:border-r-0">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {new Intl.DateTimeFormat(locale, {
                weekday: "short",
                timeZone: "UTC",
              }).format(parseDate(day))}
            </p>
            <p className="mt-1 font-mono text-xs">{parseDate(day).getUTCDate()}</p>
          </div>
        ))}
      </div>
      {members.map((member) => (
        <div
          key={member.id}
          className="grid min-h-24 grid-cols-[12rem_repeat(7,minmax(7rem,1fr))] border-b"
        >
          <div className="flex items-center gap-2 border-r p-3">
            <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold">
              {member.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-sm font-medium">{member.name}</span>
          </div>
          {days.map((day) => {
            const personItems = items.filter(
              (item) =>
                (item.assigneeId === member.id ||
                  item.attendeeIds.includes(member.id)) &&
                (item.allDay
                  ? Boolean(
                      item.startDate &&
                        item.endDate &&
                        item.startDate <= day &&
                        item.endDate > day,
                    )
                  : dateForTimedItem(item) === day),
            );
            return (
              <div key={day} className="border-r p-2 last:border-r-0">
                <div className="space-y-1">
                  {personItems.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => onSelect(item)}
                      className="w-full truncate rounded-md border-l-[3px] bg-muted/35 px-2 py-1.5 text-left text-[10px]"
                      style={{ borderLeftColor: item.color }}
                    >
                      {item.title}
                    </button>
                  ))}
                  {personItems.length === 0 && (
                    <span className="block pt-3 text-center text-[10px] text-muted-foreground/45">
                      —
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      </div>
    </div>
  );
}

function Inspector({
  item,
  locale,
  t,
  onClose,
  onEdit,
}: {
  item: CalendarItem;
  locale: string;
  t: ReturnType<typeof useTranslations<"calendar">>;
  onClose: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="sticky top-4 rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-xl text-white"
          style={{ backgroundColor: item.color }}
        >
          <SourceIcon kind={item.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("details")}
          </p>
          <h2 className="mt-1 text-base font-semibold leading-snug">{item.title}</h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <div className="mt-4 space-y-3 text-xs">
        <p className="flex items-start gap-2">
          <Clock3 className="mt-0.5 size-3.5 text-muted-foreground" />
          <span>
            {item.allDay
              ? `${item.startDate} – ${addDays(item.endDate!, -1)}`
              : new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.startAt!))}
          </span>
        </p>
        {item.location && (
          <p className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-3.5 text-muted-foreground" />
            <span>{item.location}</span>
          </p>
        )}
        {item.recurring && (
          <p className="flex items-center gap-2">
            <Repeat2 className="size-3.5 text-muted-foreground" />
            {t("recurring")}
          </p>
        )}
        {item.assigneeName && (
          <p className="flex items-center gap-2">
            <UserRound className="size-3.5 text-muted-foreground" />
            {item.assigneeName}
          </p>
        )}
        {item.description && (
          <p className="whitespace-pre-wrap border-t pt-3 leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}
      </div>
      <div className="mt-5 flex gap-2">
        {(item.kind === "event" || item.kind === "focus") && item.editable && (
          <Button size="sm" onClick={onEdit}>
            {t("edit")}
          </Button>
        )}
        {item.href && (
          <Button variant="outline" size="sm" render={<Link href={item.href} />}>
            <ExternalLink />
            {t("openSource")}
          </Button>
        )}
      </div>
    </div>
  );
}

function UnscheduledTray({
  tasks,
  t,
  onDragStart,
}: {
  tasks: CalendarWorkspace["unscheduledTasks"];
  t: ReturnType<typeof useTranslations<"calendar">>;
  onDragStart: (event: DragEvent, id: string) => void;
}) {
  return (
    <div className="sticky top-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Focus className="size-4 text-[#6D5EF7]" />
        <h2 className="text-sm font-semibold">{t("unscheduled")}</h2>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t("unscheduledDescription")}
      </p>
      <div className="mt-4 space-y-2">
        {tasks.map((task) => (
          <button
            type="button"
            draggable
            key={task.id}
            onDragStart={(event) => onDragStart(event, task.id)}
            className="flex w-full cursor-grab items-center gap-2 rounded-xl border bg-background p-2.5 text-left active:cursor-grabbing"
          >
            <GripVertical className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{task.title}</span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {task.projectName ?? task.assigneeName ?? ""}
              </span>
            </span>
          </button>
        ))}
        {tasks.length === 0 && (
          <div className="rounded-xl border border-dashed p-4 text-center">
            <Check className="mx-auto size-5 text-[#059669]" />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("noUnscheduled")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
