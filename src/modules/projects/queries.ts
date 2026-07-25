import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projectColumns,
  projects,
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
      projectId: tasks.projectId,
      columnId: tasks.columnId,
      parentTaskId: tasks.parentTaskId,
      title: tasks.title,
      description: tasks.description,
      assigneeId: tasks.assigneeId,
      assigneeName: user.name,
      dueDate: tasks.dueDate,
      startDate: tasks.startDate,
      progress: tasks.progress,
      isMilestone: tasks.isMilestone,
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
      projectId: tasks.projectId,
      parentTaskId: tasks.parentTaskId,
      columnId: tasks.columnId,
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
