import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { listDeadlineOverview, listMembers, listTaskOverview } from "@/modules/projects/queries";
import { TaskOverview } from "@/modules/tasks/components/task-overview";
import { DeadlineOverview } from "@/modules/tasks/components/deadline-overview";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    assignee?: string;
    priority?: string;
    status?: string;
    deadlineAssignee?: string;
    deadlineFrom?: string;
    deadlineTo?: string;
    deadlineStatus?: string;
  }>;
}) {
  const [user, t, query] = await Promise.all([
    requireUser(),
    getTranslations("dashboard"),
    searchParams,
  ]);
  const assignee = query.assignee || user.id;
  const priority = ["low", "medium", "high"].includes(query.priority || "") ? query.priority! : "all";
  const status = ["open", "done", "all"].includes(query.status || "") ? query.status! : "open";
  const tasks = listTaskOverview({
    assigneeId: assignee,
    priority: priority === "all" ? undefined : priority as "low" | "medium" | "high",
    status: status as "open" | "done" | "all",
  });
  const deadlineAssignee = query.deadlineAssignee || user.id;
  const deadlineStatus = ["open", "done", "all"].includes(query.deadlineStatus || "")
    ? query.deadlineStatus!
    : "open";
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const deadlineFrom = datePattern.test(query.deadlineFrom || "") ? query.deadlineFrom! : "";
  const deadlineTo = datePattern.test(query.deadlineTo || "") ? query.deadlineTo! : "";
  const deadlines = listDeadlineOverview({
    assigneeId: deadlineAssignee,
    from: deadlineFrom || undefined,
    to: deadlineTo || undefined,
    status: deadlineStatus as "open" | "done" | "all",
  });
  const members = listMembers();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("welcome", { name: user.name })}
        </p>
      </div>
      <TaskOverview tasks={tasks} members={members} filters={{ assignee, priority, status }} />
      <DeadlineOverview
        deadlines={deadlines}
        members={members}
        filters={{ assignee: deadlineAssignee, from: deadlineFrom, to: deadlineTo, status: deadlineStatus }}
      />
    </div>
  );
}
