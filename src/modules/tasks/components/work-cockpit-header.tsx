"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  CalendarRange,
  ClipboardCheck,
  ClipboardPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addLocalDays,
  compareDeadlineTiming,
  isDeadlineOverdue,
  todayLocal,
} from "../deadline-utils";
import { useDeadlineCreator } from "./deadline-create-provider";
import { useTaskCreator } from "./task-create-provider";

type PersonalWorkSummary = {
  openTaskCount: number;
  taskDueDates: Array<string | null>;
  deadlines: Array<{
    id: string;
    title: string;
    deadlineDate: string;
    deadlineAt: string | null;
    href: string;
  }>;
};

function localDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function WorkCockpitHeader({
  userName,
  summary,
}: {
  userName: string;
  summary: PersonalWorkSummary;
}) {
  const t = useTranslations("dashboard");
  const tTasks = useTranslations("tasks");
  const tDeadlines = useTranslations("deadlines");
  const format = useFormatter();
  const { openTaskCreator } = useTaskCreator();
  const { openDeadlineCreator } = useDeadlineCreator();
  const [now] = useState(() => new Date());

  const metrics = useMemo(() => {
    const today = todayLocal(now);
    const weekEnd = addLocalDays(today, 7);
    const overdueTasks = summary.taskDueDates.filter((date) => Boolean(date && date < today)).length;
    const overdueDeadlines = summary.deadlines.filter((deadline) => (
      isDeadlineOverdue({ ...deadline, status: "open" }, now)
    )).length;
    const upcomingDeadlines = summary.deadlines
      .filter((deadline) => (
        deadline.deadlineDate >= today
        && deadline.deadlineDate <= weekEnd
        && !isDeadlineOverdue({ ...deadline, status: "open" }, now)
      ))
      .sort(compareDeadlineTiming);
    const nextDeadline = summary.deadlines
      .filter((deadline) => !isDeadlineOverdue({ ...deadline, status: "open" }, now))
      .sort(compareDeadlineTiming)[0] ?? null;
    return {
      overdue: overdueTasks + overdueDeadlines,
      upcoming: upcomingDeadlines.length,
      nextDeadline,
    };
  }, [now, summary]);

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="flex flex-col gap-5 border-b px-5 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("title")}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em]">{t("todayInView")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("welcome", { name: userName })} {t("workDescription")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="lg" onClick={() => openTaskCreator()}>
            <ClipboardPlus className="text-indigo-600" />
            {tTasks("createTask")}
          </Button>
          <Button
            size="lg"
            className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
            onClick={() => openDeadlineCreator()}
          >
            <CalendarClock />
            {tDeadlines("createDeadline")}
          </Button>
        </div>
      </div>

      <div className="grid divide-y bg-[#F6F7F9] dark:bg-muted/20 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-[0.85fr_0.85fr_0.85fr_1.45fr]">
        <div className="flex min-h-28 items-center gap-3 px-5 py-4">
          <span className="grid size-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
            <ClipboardCheck className="size-4.5" />
          </span>
          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums">{summary.openTaskCount}</p>
            <p className="text-xs text-muted-foreground">{t("openTasks")}</p>
          </div>
        </div>
        <div className="flex min-h-28 items-center gap-3 px-5 py-4">
          <span className="grid size-9 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <CalendarRange className="size-4.5" />
          </span>
          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums">{metrics.upcoming}</p>
            <p className="text-xs text-muted-foreground">{t("nextSevenDays")}</p>
          </div>
        </div>
        <div className="flex min-h-28 items-center gap-3 px-5 py-4">
          <span className={`grid size-9 place-items-center rounded-xl ${metrics.overdue ? "bg-red-50 text-red-600 dark:bg-red-950/45 dark:text-red-300" : "bg-background text-muted-foreground"}`}>
            <AlertTriangle className="size-4.5" />
          </span>
          <div>
            <p className="font-mono text-2xl font-semibold tabular-nums">{metrics.overdue}</p>
            <p className="text-xs text-muted-foreground">{t("overdueItems")}</p>
          </div>
        </div>
        <div className="min-h-28 px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">{t("nextDeadline")}</p>
          {metrics.nextDeadline ? (
            <Link href={metrics.nextDeadline.href} className="mt-2 flex items-center gap-3 rounded-xl outline-none ring-offset-2 transition-opacity hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring">
              <span className="grid w-11 shrink-0 overflow-hidden rounded-lg border border-amber-200 bg-background text-center shadow-sm dark:border-amber-900">
                <span className="bg-amber-600 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
                  {format.dateTime(localDate(metrics.nextDeadline.deadlineDate), { month: "short" })}
                </span>
                <span className="py-1 font-mono text-base font-semibold leading-none">
                  {Number(metrics.nextDeadline.deadlineDate.slice(-2))}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{metrics.nextDeadline.title}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {format.dateTime(localDate(metrics.nextDeadline.deadlineDate), { dateStyle: "medium" })}
                  {metrics.nextDeadline.deadlineAt
                    ? ` · ${format.dateTime(new Date(metrics.nextDeadline.deadlineAt), { timeStyle: "short" })}`
                    : ` · ${tDeadlines("allDay")}`}
                </span>
              </span>
            </Link>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t("noNextDeadline")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
