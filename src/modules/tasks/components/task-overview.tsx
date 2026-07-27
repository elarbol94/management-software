"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  CalendarDays,
  Check,
  Circle,
  FileSearch,
  FolderKanban,
  MapPin,
  MoreHorizontal,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { setTaskStatus } from "@/modules/projects/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTaskCreator } from "./task-create-provider";
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

export function TaskOverview({
  tasks,
  members,
  filters,
}: {
  tasks: OverviewTask[];
  members: Array<{ id: string; name: string }>;
  filters: { assignee: string; priority: string; status: string };
}) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openTaskCreator } = useTaskCreator();
  const today = new Date().toISOString().slice(0, 10);
  const assigneeLabel = filters.assignee === "all"
    ? t("allUsers")
    : filters.assignee === "unassigned"
      ? t("unassigned")
      : members.find((member) => member.id === filters.assignee)?.name ?? t("allUsers");
  const priorityLabel = filters.priority === "all"
    ? t("allPriorities")
    : t(`priorities.${filters.priority as TaskPriority}`);
  const statusLabel = t(`statuses.${filters.status as TaskStatus | "all"}`);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if ((key === "priority" && value === "all") || (key === "status" && value === "open")) next.delete(key);
    else next.set(key, value);
    router.replace(`/?${next.toString()}`, { scroll: false });
  }

  async function toggle(task: OverviewTask) {
    await setTaskStatus(task.id, task.status === "done" ? "open" : "done");
    router.refresh();
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="border-b bg-gradient-to-r from-indigo-50/80 via-background to-background px-5 py-4 dark:from-indigo-950/25">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t("overview")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("overviewDescription")}</p>
          </div>
          <Button size="sm" onClick={() => openTaskCreator()}>
            <Circle className="size-3 fill-current" />
            {t("createTask")}
          </Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Select value={filters.assignee} onValueChange={(value) => setFilter("assignee", value ?? "all")}>
            <SelectTrigger className="w-full bg-background" aria-label={t("filterAssignee")}><SelectValue>{assigneeLabel}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allUsers")}</SelectItem>
              <SelectItem value="unassigned">{t("unassigned")}</SelectItem>
              {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.priority} onValueChange={(value) => setFilter("priority", value ?? "all")}>
            <SelectTrigger className="w-full bg-background" aria-label={t("filterPriority")}><SelectValue>{priorityLabel}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allPriorities")}</SelectItem>
              <SelectItem value="high">{t("priorities.high")}</SelectItem>
              <SelectItem value="medium">{t("priorities.medium")}</SelectItem>
              <SelectItem value="low">{t("priorities.low")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(value) => setFilter("status", value ?? "open")}>
            <SelectTrigger className="w-full bg-background" aria-label={t("filterStatus")}><SelectValue>{statusLabel}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t("statuses.open")}</SelectItem>
              <SelectItem value="done">{t("statuses.done")}</SelectItem>
              <SelectItem value="all">{t("statuses.all")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>
      {tasks.length === 0 ? (
        <div className="grid min-h-48 place-items-center p-8 text-center text-sm text-muted-foreground">
          <div><Check className="mx-auto mb-2 size-8 text-emerald-500" /><p>{t("empty")}</p></div>
        </div>
      ) : (
        <div className="divide-y">
          {tasks.map((task) => {
            const OriginIcon = task.contextType ? originIcons[task.contextType] : FolderKanban;
            const overdue = task.status === "open" && Boolean(task.dueDate && task.dueDate < today);
            const origin = task.contextLabel || task.projectName || task.columnName || t("origins.app");
            return (
              <article key={task.id} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/35">
                <button
                  type="button"
                  onClick={() => void toggle(task)}
                  className={`grid size-7 place-items-center rounded-full border transition-colors ${task.status === "done" ? "border-emerald-600 bg-emerald-600 text-white" : "hover:border-emerald-500 hover:text-emerald-600"}`}
                  aria-label={task.status === "done" ? t("reopen") : t("markDone")}
                >
                  {task.status === "done" ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-current opacity-20" />}
                </button>
                <Link href={task.href} className="min-w-0">
                  <p className={`truncate text-sm font-medium ${task.status === "done" ? "text-muted-foreground line-through" : ""}`}>{task.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="h-4 w-0.5 shrink-0 rounded-full" style={{ backgroundColor: task.projectColor || "#6366f1" }} />
                      <OriginIcon className="size-3.5 shrink-0" />
                      <span className="max-w-52 truncate">{origin}</span>
                    </span>
                    <span>{task.assigneeName || t("unassigned")}</span>
                    {task.dueDate && <span className={`flex items-center gap-1 ${overdue ? "font-medium text-destructive" : ""}`}><CalendarDays className="size-3" />{task.dueDate}{overdue && ` · ${t("overdue")}`}</span>}
                  </div>
                </Link>
                <div className="flex items-center gap-1">
                  <Badge variant={task.priority === "high" ? "destructive" : "outline"}>{t(`priorities.${task.priority}`)}</Badge>
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
                      <DropdownMenuItem onClick={() => void toggle(task)}>
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
    </section>
  );
}
