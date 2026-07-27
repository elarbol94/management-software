"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  BookOpen,
  CalendarClock,
  Check,
  FileSearch,
  MapPin,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { setTaskStatus } from "@/modules/projects/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deadlineDayState,
  isDeadlineOverdue,
} from "../deadline-utils";
import { useDeadlineCreator } from "./deadline-create-provider";
import type { TaskStatus } from "../types";

type OverviewDeadline = {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  deadlineDate: string;
  deadlineAt: string | null;
  status: TaskStatus;
  contextType: "wikiPage" | "wikiSource" | "pdf" | "app" | null;
  contextEntityId: string | null;
  contextRoute: string | null;
  contextLabel: string | null;
  contextAnchorJson: string | null;
  href: string;
};

const originIcons = {
  wikiPage: BookOpen,
  wikiSource: FileSearch,
  pdf: FileSearch,
  app: MapPin,
};

function localDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function DeadlineOverview({
  deadlines,
  members,
  filters,
  defaultAssignee,
}: {
  deadlines: OverviewDeadline[];
  members: Array<{ id: string; name: string }>;
  filters: { assignee: string; from: string; to: string; status: string };
  defaultAssignee: string;
}) {
  const t = useTranslations("deadlines");
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openDeadlineCreator } = useDeadlineCreator();
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => new Date());
  const assigneeLabel = filters.assignee === "all"
    ? t("allUsers")
    : filters.assignee === "unassigned"
      ? t("unassigned")
      : members.find((member) => member.id === filters.assignee)?.name ?? t("allUsers");
  const statusLabel = t(`statuses.${filters.status as TaskStatus | "all"}`);
  const adjustedFilterCount = Number(filters.assignee !== defaultAssignee)
    + Number(Boolean(filters.from))
    + Number(Boolean(filters.to))
    + Number(filters.status !== "open");

  function replaceFilters(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    update(next);
    startTransition(() => {
      router.replace(`/?${next.toString()}`, { scroll: false });
    });
  }

  function setFilter(
    key: "deadlineAssignee" | "deadlineFrom" | "deadlineTo" | "deadlineStatus",
    value: string,
  ) {
    replaceFilters((next) => {
      const isDefault = (key === "deadlineAssignee" && value === defaultAssignee)
        || (key === "deadlineStatus" && value === "open")
        || ((key === "deadlineFrom" || key === "deadlineTo") && !value);
      if (isDefault) next.delete(key);
      else next.set(key, value);
    });
  }

  function resetFilters() {
    replaceFilters((next) => {
      next.delete("deadlineAssignee");
      next.delete("deadlineFrom");
      next.delete("deadlineTo");
      next.delete("deadlineStatus");
    });
  }

  function toggle(deadline: OverviewDeadline) {
    startTransition(async () => {
      await setTaskStatus(deadline.id, deadline.status === "done" ? "open" : "done");
      router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-t-2 border-t-amber-500 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <header className="border-b px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              <CalendarClock className="size-4.5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">{t("overview")}</h2>
                <Badge variant="secondary" className="font-mono tabular-nums">{deadlines.length}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("overviewDescription")}</p>
            </div>
          </div>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={t("filter")} />}>
              <SlidersHorizontal />
              {t("filter")}
              {adjustedFilterCount > 0 && (
                <span className="grid min-w-4 place-items-center rounded-full bg-amber-600 px-1 text-[10px] text-white">{adjustedFilterCount}</span>
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 gap-3 p-3">
              <PopoverHeader><PopoverTitle>{t("filter")}</PopoverTitle></PopoverHeader>
              <Select value={filters.assignee} onValueChange={(value) => setFilter("deadlineAssignee", value ?? "all")}>
                <SelectTrigger className="w-full" aria-label={t("filterAssignee")}><SelectValue>{assigneeLabel}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allUsers")}</SelectItem>
                  <SelectItem value="unassigned">{t("unassigned")}</SelectItem>
                  {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={filters.from}
                  aria-label={t("filterFrom")}
                  title={t("filterFrom")}
                  onChange={(event) => setFilter("deadlineFrom", event.target.value)}
                />
                <Input
                  type="date"
                  value={filters.to}
                  min={filters.from || undefined}
                  aria-label={t("filterTo")}
                  title={t("filterTo")}
                  onChange={(event) => setFilter("deadlineTo", event.target.value)}
                />
              </div>
              <Select value={filters.status} onValueChange={(value) => setFilter("deadlineStatus", value ?? "open")}>
                <SelectTrigger className="w-full" aria-label={t("filterStatus")}><SelectValue>{statusLabel}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">{t("statuses.open")}</SelectItem>
                  <SelectItem value="done">{t("statuses.done")}</SelectItem>
                  <SelectItem value="all">{t("statuses.all")}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="justify-start" onClick={resetFilters}>
                <RotateCcw />
                {t("resetFilters")}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFilter("deadlineAssignee", "all")} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {assigneeLabel}<X className="size-3" />
          </button>
          {filters.from && (
            <button type="button" onClick={() => setFilter("deadlineFrom", "")} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
              {t("filterFrom")}: {filters.from}<X className="size-3" />
            </button>
          )}
          {filters.to && (
            <button type="button" onClick={() => setFilter("deadlineTo", "")} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground">
              {t("filterTo")}: {filters.to}<X className="size-3" />
            </button>
          )}
          <button type="button" onClick={() => setFilter("deadlineStatus", "all")} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {statusLabel}<X className="size-3" />
          </button>
        </div>
      </header>

      <div className={pending ? "opacity-55 transition-opacity" : "transition-opacity"}>
        {deadlines.length === 0 ? (
          <div className="grid min-h-56 place-items-center px-6 py-10 text-center">
            <div>
              <Check className="mx-auto mb-3 size-8 text-emerald-500" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={resetFilters}>{t("resetFilters")}</Button>
                <Button size="sm" className="bg-amber-600 text-white hover:bg-amber-700" onClick={() => openDeadlineCreator()}>{t("createDeadline")}</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {deadlines.map((deadline) => {
              const OriginIcon = deadline.contextType ? originIcons[deadline.contextType] : MapPin;
              const overdue = isDeadlineOverdue(deadline, now);
              const dayState = deadlineDayState(deadline, now);
              const origin = deadline.contextLabel || t("origins.app");
              const stateLabel = dayState === "overdue"
                ? t("overdue")
                : dayState === "today"
                  ? t("today")
                  : dayState === "tomorrow"
                    ? t("tomorrow")
                    : null;
              return (
                <article key={deadline.id} className="group grid min-h-24 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                  <Link
                    href={deadline.href}
                    className="grid w-11 shrink-0 overflow-hidden rounded-lg border border-amber-200 bg-background text-center shadow-sm outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring dark:border-amber-900"
                    aria-label={`${deadline.title}, ${format.dateTime(localDate(deadline.deadlineDate), { dateStyle: "medium" })}`}
                  >
                    <span className={`py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white ${overdue ? "bg-red-600" : deadline.status === "done" ? "bg-emerald-600" : "bg-amber-600"}`}>
                      {format.dateTime(localDate(deadline.deadlineDate), { month: "short" })}
                    </span>
                    <span className="py-1 font-mono text-base font-semibold leading-none">
                      {Number(deadline.deadlineDate.slice(-2))}
                    </span>
                  </Link>
                  <Link href={deadline.href} className="min-w-0 rounded-md outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring">
                    <p className={`truncate text-sm font-semibold ${deadline.status === "done" ? "text-muted-foreground line-through" : ""}`}>{deadline.title}</p>
                    {deadline.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{deadline.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-1">
                        <OriginIcon className="size-3.5 shrink-0" />
                        <span className="max-w-40 truncate">{origin}</span>
                      </span>
                      <span>{deadline.assigneeName || t("unassigned")}</span>
                      <span className={`font-mono ${overdue ? "font-medium text-destructive" : ""}`}>
                        {deadline.deadlineAt
                          ? format.dateTime(new Date(deadline.deadlineAt), { timeStyle: "short" })
                          : t("allDay")}
                      </span>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1">
                    <Badge variant={overdue ? "destructive" : "outline"}>
                      {stateLabel || t(`statuses.${deadline.status}`)}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("edit")} />}><MoreHorizontal /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDeadlineCreator({
                          deadline: {
                            id: deadline.id,
                            title: deadline.title,
                            description: deadline.description,
                            assigneeId: deadline.assigneeId,
                            deadlineDate: deadline.deadlineDate,
                            deadlineAt: deadline.deadlineAt,
                            status: deadline.status,
                          },
                          origin: deadline.contextType && deadline.contextRoute ? {
                            type: deadline.contextType,
                            entityId: deadline.contextEntityId || "",
                            route: deadline.contextRoute,
                            label: origin,
                            anchor: (() => {
                              try { return JSON.parse(deadline.contextAnchorJson || "{}") as Record<string, unknown>; }
                              catch { return {}; }
                            })(),
                          } : undefined,
                        })}><Pencil />{t("edit")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggle(deadline)}>
                          {deadline.status === "done" ? <RotateCcw /> : <Check />}
                          {deadline.status === "done" ? t("reopen") : t("markDone")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
