"use client";

import Link from "next/link";
import { useState } from "react";
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
} from "lucide-react";
import { setTaskStatus } from "@/modules/projects/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { useDeadlineCreator } from "./deadline-create-provider";
import type { TaskStatus } from "../types";

type OverviewDeadline = {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  deadlineAt: string;
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

export function DeadlineOverview({
  deadlines,
  members,
  filters,
}: {
  deadlines: OverviewDeadline[];
  members: Array<{ id: string; name: string }>;
  filters: { assignee: string; from: string; to: string; status: string };
}) {
  const t = useTranslations("deadlines");
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openDeadlineCreator } = useDeadlineCreator();
  const [renderedAt] = useState(() => Date.now());
  const assigneeLabel = filters.assignee === "all"
    ? t("allUsers")
    : filters.assignee === "unassigned"
      ? t("unassigned")
      : members.find((member) => member.id === filters.assignee)?.name ?? t("allUsers");
  const statusLabel = t(`statuses.${filters.status as TaskStatus | "all"}`);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || (key === "deadlineStatus" && value === "open")) next.delete(key);
    else next.set(key, value);
    router.replace(`/?${next.toString()}`, { scroll: false });
  }

  async function toggle(deadline: OverviewDeadline) {
    await setTaskStatus(deadline.id, deadline.status === "done" ? "open" : "done");
    router.refresh();
  }

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="border-b bg-gradient-to-r from-amber-50/90 via-background to-background px-5 py-4 dark:from-amber-950/25">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{t("overview")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("overviewDescription")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => openDeadlineCreator()} className="border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200">
            <CalendarClock className="size-4" />
            {t("createDeadline")}
          </Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Select value={filters.assignee} onValueChange={(value) => setFilter("deadlineAssignee", value ?? "all")}>
            <SelectTrigger className="w-full bg-background" aria-label={t("filterAssignee")}><SelectValue>{assigneeLabel}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allUsers")}</SelectItem>
              <SelectItem value="unassigned">{t("unassigned")}</SelectItem>
              {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={filters.from}
            aria-label={t("filterFrom")}
            title={t("filterFrom")}
            onChange={(event) => setFilter("deadlineFrom", event.target.value)}
            className="bg-background"
          />
          <Input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            aria-label={t("filterTo")}
            title={t("filterTo")}
            onChange={(event) => setFilter("deadlineTo", event.target.value)}
            className="bg-background"
          />
          <Select value={filters.status} onValueChange={(value) => setFilter("deadlineStatus", value ?? "open")}>
            <SelectTrigger className="w-full bg-background" aria-label={t("filterStatus")}><SelectValue>{statusLabel}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">{t("statuses.open")}</SelectItem>
              <SelectItem value="done">{t("statuses.done")}</SelectItem>
              <SelectItem value="all">{t("statuses.all")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>
      {deadlines.length === 0 ? (
        <div className="grid min-h-40 place-items-center p-8 text-center text-sm text-muted-foreground">
          <div><Check className="mx-auto mb-2 size-8 text-emerald-500" /><p>{t("empty")}</p></div>
        </div>
      ) : (
        <div className="divide-y">
          {deadlines.map((deadline) => {
            const OriginIcon = deadline.contextType ? originIcons[deadline.contextType] : MapPin;
            const overdue = deadline.status === "open" && new Date(deadline.deadlineAt).getTime() < renderedAt;
            const origin = deadline.contextLabel || t("origins.app");
            return (
              <article key={deadline.id} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/35">
                <button
                  type="button"
                  onClick={() => void toggle(deadline)}
                  className={`grid size-7 place-items-center rounded-full border transition-colors ${deadline.status === "done" ? "border-emerald-600 bg-emerald-600 text-white" : "border-amber-300 hover:border-emerald-500 hover:text-emerald-600"}`}
                  aria-label={deadline.status === "done" ? t("reopen") : t("markDone")}
                >
                  {deadline.status === "done" ? <Check className="size-4" /> : <span className="size-2 rounded-full bg-amber-500" />}
                </button>
                <Link href={deadline.href} className="min-w-0">
                  <p className={`truncate text-sm font-medium ${deadline.status === "done" ? "text-muted-foreground line-through" : ""}`}>{deadline.title}</p>
                  {deadline.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{deadline.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex min-w-0 items-center gap-1"><OriginIcon className="size-3.5 shrink-0" /><span className="max-w-52 truncate">{origin}</span></span>
                    <span>{deadline.assigneeName || t("unassigned")}</span>
                    <span className={`flex items-center gap-1 ${overdue ? "font-medium text-destructive" : ""}`}>
                      <CalendarClock className="size-3.5" />
                      {format.dateTime(new Date(deadline.deadlineAt), { dateStyle: "medium", timeStyle: "short" })}
                      {overdue && ` · ${t("overdue")}`}
                    </span>
                  </div>
                </Link>
                <div className="flex items-center gap-1">
                  <Badge variant={overdue ? "destructive" : "outline"}>{t(`statuses.${deadline.status}`)}</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("edit")} />}><MoreHorizontal /></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openDeadlineCreator({
                        deadline: {
                          id: deadline.id,
                          title: deadline.title,
                          description: deadline.description,
                          assigneeId: deadline.assigneeId,
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
                      <DropdownMenuItem onClick={() => void toggle(deadline)}>
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
    </section>
  );
}
