"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  BookOpen,
  CalendarDays,
  Check,
  FileSearch,
  FolderKanban,
  ListChecks,
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
import { useTaskCreator } from "./task-create-provider";
import { todayLocal } from "../deadline-utils";
import type { TaskPriority, TaskStatus } from "../types";

type OverviewTask = {
  id: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  columnName: string | null;
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

export function TaskOverview({
  tasks,
  members,
  filters,
  defaultAssignee,
}: {
  tasks: OverviewTask[];
  members: Array<{ id: string; name: string }>;
  filters: { assignee: string; priority: string; status: string };
  defaultAssignee: string;
}) {
  const t = useTranslations("tasks");
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openTaskCreator } = useTaskCreator();
  const [pending, startTransition] = useTransition();
  const [now] = useState(() => new Date());
  const today = todayLocal(now);
  const assigneeLabel = filters.assignee === "all"
    ? t("allUsers")
    : filters.assignee === "unassigned"
      ? t("unassigned")
      : members.find((member) => member.id === filters.assignee)?.name ?? t("allUsers");
  const priorityLabel = filters.priority === "all"
    ? t("allPriorities")
    : t(`priorities.${filters.priority as TaskPriority}`);
  const statusLabel = t(`statuses.${filters.status as TaskStatus | "all"}`);
  const adjustedFilterCount = Number(filters.assignee !== defaultAssignee)
    + Number(filters.priority !== "all")
    + Number(filters.status !== "open");

  function replaceFilters(update: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    update(next);
    startTransition(() => {
      router.replace(`/?${next.toString()}`, { scroll: false });
    });
  }

  function setFilter(key: "assignee" | "priority" | "status", value: string) {
    replaceFilters((next) => {
      const isDefault = (key === "assignee" && value === defaultAssignee)
        || (key === "priority" && value === "all")
        || (key === "status" && value === "open");
      if (isDefault) next.delete(key);
      else next.set(key, value);
    });
  }

  function resetFilters() {
    replaceFilters((next) => {
      next.delete("assignee");
      next.delete("priority");
      next.delete("status");
    });
  }

  function toggle(task: OverviewTask) {
    startTransition(async () => {
      await setTaskStatus(task.id, task.status === "done" ? "open" : "done");
      router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-t-2 border-t-indigo-500 bg-card shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <header className="border-b px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
              <ListChecks className="size-4.5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">{t("overview")}</h2>
                <Badge variant="secondary" className="font-mono tabular-nums">{tasks.length}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("overviewDescription")}</p>
            </div>
          </div>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" aria-label={t("filter")} />}>
              <SlidersHorizontal />
              {t("filter")}
              {adjustedFilterCount > 0 && (
                <span className="grid min-w-4 place-items-center rounded-full bg-indigo-600 px-1 text-[10px] text-white">{adjustedFilterCount}</span>
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 gap-3 p-3">
              <PopoverHeader>
                <PopoverTitle>{t("filter")}</PopoverTitle>
              </PopoverHeader>
              <Select value={filters.assignee} onValueChange={(value) => setFilter("assignee", value ?? "all")}>
                <SelectTrigger className="w-full" aria-label={t("filterAssignee")}><SelectValue>{assigneeLabel}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allUsers")}</SelectItem>
                  <SelectItem value="unassigned">{t("unassigned")}</SelectItem>
                  {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.priority} onValueChange={(value) => setFilter("priority", value ?? "all")}>
                <SelectTrigger className="w-full" aria-label={t("filterPriority")}><SelectValue>{priorityLabel}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allPriorities")}</SelectItem>
                  <SelectItem value="high">{t("priorities.high")}</SelectItem>
                  <SelectItem value="medium">{t("priorities.medium")}</SelectItem>
                  <SelectItem value="low">{t("priorities.low")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filters.status} onValueChange={(value) => setFilter("status", value ?? "open")}>
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
          <button type="button" onClick={() => setFilter("assignee", "all")} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {assigneeLabel}<X className="size-3" />
          </button>
          {filters.priority !== "all" && (
            <button type="button" onClick={() => setFilter("priority", "all")} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              {priorityLabel}<X className="size-3" />
            </button>
          )}
          <button type="button" onClick={() => setFilter("status", "all")} className="inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            {statusLabel}<X className="size-3" />
          </button>
        </div>
      </header>

      <div className={pending ? "opacity-55 transition-opacity" : "transition-opacity"}>
        {tasks.length === 0 ? (
          <div className="grid min-h-56 place-items-center px-6 py-10 text-center">
            <div>
              <Check className="mx-auto mb-3 size-8 text-emerald-500" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={resetFilters}>{t("resetFilters")}</Button>
                <Button size="sm" onClick={() => openTaskCreator()}>{t("createTask")}</Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="divide-y">
            {tasks.map((task) => {
              const OriginIcon = task.contextType ? originIcons[task.contextType] : FolderKanban;
              const overdue = task.status === "open" && Boolean(task.dueDate && task.dueDate < today);
              const origin = task.contextLabel || task.projectName || task.columnName || t("origins.app");
              return (
                <article key={task.id} className="group grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                  <button
                    type="button"
                    onClick={() => toggle(task)}
                    className={`grid size-7 place-items-center rounded-full border transition-colors ${task.status === "done" ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:border-emerald-500 hover:text-emerald-600"}`}
                    aria-label={task.status === "done" ? t("reopen") : t("markDone")}
                  >
                    {task.status === "done" ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-current opacity-15" />}
                  </button>
                  <Link href={task.href} className="min-w-0 rounded-md outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring">
                    <p className={`truncate text-sm font-semibold ${task.status === "done" ? "text-muted-foreground line-through" : ""}`}>{task.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="h-4 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: task.projectColor || "#4F46E5" }} />
                        <OriginIcon className="size-3.5 shrink-0" />
                        <span className="max-w-56 truncate">{origin}</span>
                      </span>
                      <span>{task.assigneeName || t("unassigned")}</span>
                      {task.dueDate && (
                        <span className={`flex items-center gap-1 font-mono ${overdue ? "font-medium text-destructive" : ""}`}>
                          <CalendarDays className="size-3" />
                          {format.dateTime(localDate(task.dueDate), { dateStyle: "medium" })}
                          {overdue && ` · ${t("overdue")}`}
                        </span>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant={task.priority === "high" ? "destructive" : "outline"}
                      className={task.priority === "low" ? "text-muted-foreground" : ""}
                    >
                      {t(`priorities.${task.priority}`)}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("edit")} />}><MoreHorizontal /></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openTaskCreator({
                          task: {
                            id: task.id,
                            title: task.title,
                            assigneeId: task.assigneeId,
                            priority: task.priority,
                            dueDate: task.dueDate,
                            status: task.status,
                            projectId: task.projectId,
                          },
                          origin: task.contextType && task.contextRoute ? {
                            type: task.contextType,
                            entityId: task.contextEntityId || "",
                            route: task.contextRoute,
                            label: task.contextLabel || origin,
                            anchor: (() => {
                              try { return JSON.parse(task.contextAnchorJson || "{}") as Record<string, unknown>; }
                              catch { return {}; }
                            })(),
                          } : undefined,
                        })}><Pencil />{t("edit")}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => toggle(task)}>
                          {task.status === "done" ? <RotateCcw /> : <Check />}
                          {task.status === "done" ? t("reopen") : t("markDone")}
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
