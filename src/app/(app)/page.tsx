import { requireUser } from "@/lib/auth";
import {
  getPersonalWorkSummary,
  listDeadlineOverview,
  listMembers,
  listTaskOverview,
} from "@/modules/projects/queries";
import { TaskOverview } from "@/modules/tasks/components/task-overview";
import { DeadlineOverview } from "@/modules/tasks/components/deadline-overview";
import { WorkCockpitHeader } from "@/modules/tasks/components/work-cockpit-header";

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
  const [user, query] = await Promise.all([
    requireUser(),
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
  const summary = getPersonalWorkSummary(user.id);

  return (
    <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-5">
      <WorkCockpitHeader userName={user.name} summary={summary} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(24rem,5fr)]">
        <TaskOverview
          tasks={tasks}
          members={members}
          defaultAssignee={user.id}
          filters={{ assignee, priority, status }}
        />
        <DeadlineOverview
          deadlines={deadlines}
          members={members}
          defaultAssignee={user.id}
          filters={{ assignee: deadlineAssignee, from: deadlineFrom, to: deadlineTo, status: deadlineStatus }}
        />
      </div>
    </div>
  );
}
