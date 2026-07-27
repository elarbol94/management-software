import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  projectColumns,
  projects,
  taskContexts,
  taskDependencies,
  tasks,
  user,
} from "@/db/schema";

export function listProjects(options?: { includeArchived?: boolean }) {
  const where = options?.includeArchived
    ? undefined
    : eq(projects.status, "active");

  const rows = db
    .select()
    .from(projects)
    .where(where)
    .orderBy(asc(projects.createdAt))
    .all();

  if (rows.length === 0) return rows.map((row) => ({ ...row, openTasks: 0 }));

  const counts = db
    .select({ projectId: tasks.projectId, count: sql<number>`count(*)` })
    .from(tasks)
    .where(isNull(tasks.parentTaskId))
    .groupBy(tasks.projectId)
    .all();
  const countMap = new Map(counts.map((c) => [c.projectId, c.count]));

  return rows.map((row) => ({
    ...row,
    openTasks: countMap.get(row.id) ?? 0,
  }));
}

export function getProject(id: string) {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

export type BoardColumn = ReturnType<typeof getBoard>["columns"][number];
export type BoardTask = ReturnType<typeof getBoard>["tasksByColumn"][string][number];

export function getBoard(projectId: string) {
  const columns = db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.projectId, projectId))
    .orderBy(asc(projectColumns.sortOrder))
    .all();

  const taskRows = db
    .select({
      id: tasks.id,
      projectId: sql<string>`${tasks.projectId}`,
      columnId: sql<string>`${tasks.columnId}`,
      parentTaskId: tasks.parentTaskId,
      title: tasks.title,
      description: tasks.description,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      progress: tasks.progress,
      isMilestone: tasks.isMilestone,
      constraintType: tasks.constraintType,
      constraintDate: tasks.constraintDate,
      priority: tasks.priority,
      sortOrder: tasks.sortOrder,
    })
    .from(tasks)
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.sortOrder))
    .all();

  const tasksByColumn: Record<string, typeof taskRows> = {};
  const subtasksByParent: Record<string, typeof taskRows> = {};
  for (const column of columns) tasksByColumn[column.id] = [];
  for (const task of taskRows) {
    if (task.parentTaskId) {
      (subtasksByParent[task.parentTaskId] ??= []).push(task);
    } else {
      (tasksByColumn[task.columnId] ??= []).push(task);
    }
  }

  return { columns, tasksByColumn, subtasksByParent };
}

export type PortfolioSchedule = ReturnType<typeof getPortfolioSchedule>;
export type PortfolioTask = PortfolioSchedule["tasks"][number];

export function getPortfolioSchedule() {
  const projectRows = db
    .select()
    .from(projects)
    .where(eq(projects.status, "active"))
    .orderBy(asc(projects.createdAt))
    .all();

  const taskRows = db
    .select({
      id: tasks.id,
      projectId: sql<string>`${tasks.projectId}`,
      parentTaskId: tasks.parentTaskId,
      columnId: sql<string>`${tasks.columnId}`,
      columnName: projectColumns.name,
      columnIsCompleted: projectColumns.isCompleted,
      title: tasks.title,
      description: tasks.description,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      progress: tasks.progress,
      isMilestone: tasks.isMilestone,
      constraintType: tasks.constraintType,
      constraintDate: tasks.constraintDate,
      priority: tasks.priority,
      sortOrder: tasks.sortOrder,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(projectColumns, eq(tasks.columnId, projectColumns.id))
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .where(eq(projects.status, "active"))
    .orderBy(asc(tasks.projectId), asc(tasks.sortOrder))
    .all();

  const deadlineRows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      dueDate: tasks.dueDate,
      deadlineAt: tasks.deadlineAt,
      status: tasks.status,
      contextRoute: taskContexts.route,
      contextLabel: taskContexts.label,
    })
    .from(tasks)
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .leftJoin(taskContexts, eq(tasks.id, taskContexts.taskId))
    .where(eq(tasks.kind, "deadline"))
    .orderBy(
      asc(tasks.dueDate),
      sql`${tasks.deadlineAt} IS NOT NULL`,
      asc(tasks.deadlineAt),
    )
    .all()
    .map((deadline) => ({
      ...deadline,
      deadlineAt: deadline.deadlineAt?.toISOString() ?? null,
    }));

  const dependencyRows = db
    .select()
    .from(taskDependencies)
    .orderBy(asc(taskDependencies.createdAt))
    .all();
  const columnRows = db
    .select()
    .from(projectColumns)
    .orderBy(asc(projectColumns.projectId), asc(projectColumns.sortOrder))
    .all();
  const activeTaskIds = new Set(taskRows.map((task) => task.id));

  return {
    projects: projectRows,
    tasks: taskRows,
    deadlines: deadlineRows,
    columns: columnRows.filter((column) =>
      projectRows.some((project) => project.id === column.projectId),
    ),
    dependencies: dependencyRows.filter(
      (dependency) =>
        activeTaskIds.has(dependency.predecessorTaskId) &&
        activeTaskIds.has(dependency.successorTaskId),
    ),
    members: listMembers(),
  };
}

export function listMembers() {
  return db
    .select({ id: user.id, name: user.name })
    .from(user)
    .orderBy(asc(user.name))
    .all();
}

export function getTaskDialogOptions() {
  return {
    members: listMembers(),
    projects: db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.status, "active"))
      .orderBy(asc(projects.name))
      .all(),
  };
}

export type TaskOverviewFilters = {
  assigneeId?: string;
  priority?: "low" | "medium" | "high";
  status?: "open" | "done" | "all";
};

export function listTaskOverview(filters: TaskOverviewFilters = {}) {
  const conditions: SQL[] = [eq(tasks.kind, "task")];
  if (filters.assigneeId && filters.assigneeId !== "all") {
    conditions.push(
      filters.assigneeId === "unassigned"
        ? isNull(tasks.assigneeId)
        : eq(tasks.assigneeId, filters.assigneeId),
    );
  }
  if (filters.priority) conditions.push(eq(tasks.priority, filters.priority));
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(tasks.status, filters.status));
  }

  const rows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      priority: tasks.priority,
      status: tasks.status,
      dueDate: tasks.dueDate,
      projectId: tasks.projectId,
      projectName: projects.name,
      projectColor: projects.color,
      columnName: projectColumns.name,
      contextType: taskContexts.type,
      contextEntityId: taskContexts.entityId,
      contextRoute: taskContexts.route,
      contextLabel: taskContexts.label,
      contextAnchorJson: taskContexts.anchorJson,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(projectColumns, eq(tasks.columnId, projectColumns.id))
    .leftJoin(taskContexts, eq(tasks.id, taskContexts.taskId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      sql`CASE ${tasks.priority} WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
      sql`${tasks.dueDate} IS NULL`,
      asc(tasks.dueDate),
      desc(tasks.updatedAt),
    )
    .all();

  return rows.map((task) => {
    const separator = task.contextRoute?.includes("?") ? "&" : "?";
    return {
      ...task,
      href: task.contextRoute
        ? `${task.contextRoute}${separator}task=${encodeURIComponent(task.id)}`
        : task.projectId
          ? `/projects?focus=${encodeURIComponent(task.id)}`
          : "/",
    };
  });
}

export type DeadlineOverviewFilters = {
  assigneeId?: string;
  from?: string;
  to?: string;
  status?: "open" | "done" | "all";
};

export function listDeadlineOverview(filters: DeadlineOverviewFilters = {}) {
  const conditions: SQL[] = [eq(tasks.kind, "deadline")];
  if (filters.assigneeId && filters.assigneeId !== "all") {
    conditions.push(
      filters.assigneeId === "unassigned"
        ? isNull(tasks.assigneeId)
        : eq(tasks.assigneeId, filters.assigneeId),
    );
  }
  if (filters.from) conditions.push(gte(tasks.dueDate, filters.from));
  if (filters.to) conditions.push(lte(tasks.dueDate, filters.to));
  if (filters.status && filters.status !== "all") {
    conditions.push(eq(tasks.status, filters.status));
  }

  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      deadlineDate: tasks.dueDate,
      deadlineAt: tasks.deadlineAt,
      status: tasks.status,
      contextType: taskContexts.type,
      contextEntityId: taskContexts.entityId,
      contextRoute: taskContexts.route,
      contextLabel: taskContexts.label,
      contextAnchorJson: taskContexts.anchorJson,
    })
    .from(tasks)
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .leftJoin(taskContexts, eq(tasks.id, taskContexts.taskId))
    .where(and(...conditions))
    .orderBy(
      asc(tasks.dueDate),
      sql`${tasks.deadlineAt} IS NOT NULL`,
      asc(tasks.deadlineAt),
    )
    .all()
    .map((deadline) => {
      const separator = deadline.contextRoute?.includes("?") ? "&" : "?";
      return {
        ...deadline,
        deadlineDate: deadline.deadlineDate ?? "",
        deadlineAt: deadline.deadlineAt?.toISOString() ?? null,
        href: deadline.contextRoute
          ? `${deadline.contextRoute}${separator}deadline=${encodeURIComponent(deadline.id)}`
          : "/",
      };
    });
}

export function listTasksForContext(
  type: "wikiPage" | "wikiSource" | "pdf" | "app",
  entityId: string,
) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      priority: tasks.priority,
      status: tasks.status,
      dueDate: tasks.dueDate,
      route: taskContexts.route,
      label: taskContexts.label,
      anchorJson: taskContexts.anchorJson,
    })
    .from(taskContexts)
    .innerJoin(tasks, eq(taskContexts.taskId, tasks.id))
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .where(and(
      eq(taskContexts.type, type),
      eq(taskContexts.entityId, entityId),
      eq(tasks.kind, "task"),
    ))
    .orderBy(asc(tasks.createdAt))
    .all();
}

export function listDeadlinesForContext(
  type: "wikiPage" | "wikiSource" | "pdf" | "app",
  entityId: string,
) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      deadlineDate: tasks.dueDate,
      deadlineAt: tasks.deadlineAt,
      status: tasks.status,
      route: taskContexts.route,
      label: taskContexts.label,
      anchorJson: taskContexts.anchorJson,
    })
    .from(taskContexts)
    .innerJoin(tasks, eq(taskContexts.taskId, tasks.id))
    .leftJoin(user, eq(tasks.assigneeId, user.id))
    .where(and(
      eq(taskContexts.type, type),
      eq(taskContexts.entityId, entityId),
      eq(tasks.kind, "deadline"),
    ))
    .orderBy(
      asc(tasks.dueDate),
      sql`${tasks.deadlineAt} IS NOT NULL`,
      asc(tasks.deadlineAt),
    )
    .all()
    .map((deadline) => ({
      ...deadline,
      deadlineDate: deadline.deadlineDate ?? "",
      deadlineAt: deadline.deadlineAt?.toISOString() ?? null,
    }));
}

export function getPersonalWorkSummary(userId: string) {
  const taskRows = db
    .select({ dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(
      eq(tasks.kind, "task"),
      eq(tasks.status, "open"),
      eq(tasks.assigneeId, userId),
    ))
    .all();

  const deadlineRows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      deadlineDate: tasks.dueDate,
      deadlineAt: tasks.deadlineAt,
      contextRoute: taskContexts.route,
    })
    .from(tasks)
    .leftJoin(taskContexts, eq(tasks.id, taskContexts.taskId))
    .where(and(
      eq(tasks.kind, "deadline"),
      eq(tasks.status, "open"),
      eq(tasks.assigneeId, userId),
    ))
    .orderBy(
      asc(tasks.dueDate),
      sql`${tasks.deadlineAt} IS NOT NULL`,
      asc(tasks.deadlineAt),
    )
    .all()
    .map((deadline) => {
      const separator = deadline.contextRoute?.includes("?") ? "&" : "?";
      return {
        id: deadline.id,
        title: deadline.title,
        deadlineDate: deadline.deadlineDate ?? "",
        deadlineAt: deadline.deadlineAt?.toISOString() ?? null,
        href: deadline.contextRoute
          ? `${deadline.contextRoute}${separator}deadline=${encodeURIComponent(deadline.id)}`
          : "/",
      };
    });

  return {
    openTaskCount: taskRows.length,
    taskDueDates: taskRows.map((task) => task.dueDate),
    deadlines: deadlineRows,
  };
}

/** Open tasks assigned to a user across all active projects (for the dashboard). */
export function listMyTasks(userId: string) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      projectId: tasks.projectId,
      projectName: projects.name,
      projectColor: projects.color,
      columnName: projectColumns.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(projectColumns, eq(tasks.columnId, projectColumns.id))
    .where(
      and(
        eq(tasks.assigneeId, userId),
        eq(projects.status, "active"),
        isNull(tasks.parentTaskId),
      ),
    )
    .orderBy(sql`${tasks.dueDate} IS NULL`, asc(tasks.dueDate))
    .all();
}
