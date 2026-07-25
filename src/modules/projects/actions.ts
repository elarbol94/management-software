"use server";

import { z } from "zod";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  projectColumns,
  projectScheduleChangeItems,
  projects,
  scheduleChangeItems,
  scheduleChangeSets,
  taskDependencies,
  tasks,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import {
  assertTaskHierarchy,
  clampContainerToChildren,
  descendantEnvelope,
  expandContainerToChildren,
  hasDependencyCycle,
  leafTasks,
  normalizeToWorkday,
  previewScheduleCascade,
  shiftScheduledTasks,
  taskAncestors,
  taskDescendants,
  weightedProgress,
  workdayDistance,
} from "@/modules/projects/schedule";

const SORT_GAP = 1000;

// --- Projects ---

const projectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#2563eb"),
  managerId: z.string().nullable().optional().default(null),
  plannedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  targetEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .default(null),
}).superRefine((data, context) => {
  if (
    data.plannedStartDate &&
    data.targetEndDate &&
    data.targetEndDate < data.plannedStartDate
  ) {
    context.addIssue({
      code: "custom",
      path: ["targetEndDate"],
      message: "Target completion precedes planned start",
    });
  }
});

export type ProjectInput = z.infer<typeof projectSchema>;

// Column names are created per locale on the client side.
export async function upsertProject(
  input: ProjectInput,
  defaultColumns?: string[],
): Promise<typeof projects.$inferSelect> {
  const user = await requireUserOrThrow();
  const data = projectSchema.parse(input);

  if (data.id) {
    db.update(projects)
      .set({
        name: data.name,
        description: data.description,
        color: data.color,
        managerId: data.managerId,
        plannedStartDate: data.plannedStartDate,
        targetEndDate: data.targetEndDate,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, data.id))
      .run();
    syncProjectBounds(data.id);
    revalidatePath("/projects");
    return db.select().from(projects).where(eq(projects.id, data.id)).get()!;
  }

  const row = db
    .insert(projects)
    .values({
      name: data.name,
      description: data.description,
      color: data.color,
      managerId: data.managerId,
      plannedStartDate: data.plannedStartDate,
      targetEndDate: data.targetEndDate,
      createdBy: user.id,
    })
    .returning({ id: projects.id })
    .get();

  const columnNames = (defaultColumns ?? ["Offen", "In Arbeit", "Erledigt"])
    .slice(0, 10)
    .filter((name) => name.trim().length > 0);
  db.insert(projectColumns)
    .values(
      columnNames.map((name, index) => ({
        projectId: row.id,
        name,
        sortOrder: (index + 1) * SORT_GAP,
        isCompleted: index === columnNames.length - 1,
      })),
    )
    .run();

  revalidatePath("/projects");
  return db.select().from(projects).where(eq(projects.id, row.id)).get()!;
}

export async function setProjectStatus(id: string, status: "active" | "archived") {
  await requireUserOrThrow();
  db.update(projects)
    .set({ status, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .run();
  revalidatePath("/projects");
}

export async function deleteProject(id: string) {
  await requireUserOrThrow();
  db.delete(projects).where(eq(projects.id, id)).run();
  revalidatePath("/projects");
}

// --- Columns ---

const columnSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  name: z.string().min(1).max(100),
  isCompleted: z.boolean().optional(),
});

export async function upsertColumn(input: z.infer<typeof columnSchema>) {
  await requireUserOrThrow();
  const data = columnSchema.parse(input);

  if (data.id) {
    const columnId = data.id;
    db.transaction(() => {
      db.update(projectColumns)
        .set({
          name: data.name,
          ...(data.isCompleted === undefined
            ? {}
            : { isCompleted: data.isCompleted }),
        })
        .where(eq(projectColumns.id, columnId))
        .run();
      if (data.isCompleted) {
        db.update(tasks)
          .set({ progress: 100, updatedAt: new Date() })
          .where(eq(tasks.columnId, columnId))
          .run();
      }
      if (data.isCompleted !== undefined) syncProjectParents(data.projectId);
    });
  } else {
    const max =
      db
        .select({ value: sql<number>`coalesce(max(${projectColumns.sortOrder}), 0)` })
        .from(projectColumns)
        .where(eq(projectColumns.projectId, data.projectId))
        .get()?.value ?? 0;
    db.insert(projectColumns)
      .values({
        projectId: data.projectId,
        name: data.name,
        isCompleted: data.isCompleted ?? false,
        sortOrder: max + SORT_GAP,
      })
      .run();
  }
  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/projects");
}

/** Deleting a column moves its tasks to the first remaining column. */
export async function deleteColumn(id: string) {
  await requireUserOrThrow();
  const column = db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.id, id))
    .get();
  if (!column) return;

  const fallback = db
    .select()
    .from(projectColumns)
    .where(
      and(
        eq(projectColumns.projectId, column.projectId),
        sql`${projectColumns.id} != ${id}`,
      ),
    )
    .orderBy(asc(projectColumns.sortOrder))
    .get();
  if (!fallback) throw new Error("Cannot delete the last column");

  db.transaction(() => {
    db.update(tasks)
      .set({
        columnId: fallback.id,
        ...(fallback.isCompleted ? { progress: 100 } : {}),
      })
      .where(eq(tasks.columnId, id))
      .run();
    db.delete(projectColumns).where(eq(projectColumns.id, id)).run();
    syncProjectParents(column.projectId);
  });
  revalidatePath(`/projects/${column.projectId}`);
  revalidatePath("/projects");
}

// --- Tasks ---

const taskSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  columnId: z.string().min(1),
  parentTaskId: z.string().nullable().optional().default(null),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).default(""),
  assigneeId: z.string().nullable().default(null),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  progress: z.number().int().min(0).max(100).optional().default(0),
  isMilestone: z.boolean().optional().default(false),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

export type TaskInput = z.infer<typeof taskSchema>;

function nextSortOrder(columnId: string, parentTaskId: string | null): number {
  const scope = parentTaskId
    ? eq(tasks.parentTaskId, parentTaskId)
    : and(eq(tasks.columnId, columnId), isNull(tasks.parentTaskId));
  const max =
    db
      .select({ value: sql<number>`coalesce(max(${tasks.sortOrder}), 0)` })
      .from(tasks)
      .where(scope)
      .get()?.value ?? 0;
  return max + SORT_GAP;
}

function taskHasDependencies(taskId: string): boolean {
  return Boolean(
    db
      .select({ id: taskDependencies.id })
      .from(taskDependencies)
      .where(
        or(
          eq(taskDependencies.predecessorTaskId, taskId),
          eq(taskDependencies.successorTaskId, taskId),
        ),
      )
      .get(),
  );
}

function projectHierarchyRows(projectId: string) {
  return db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      parentTaskId: tasks.parentTaskId,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      progress: tasks.progress,
      isMilestone: tasks.isMilestone,
      columnId: tasks.columnId,
      columnIsCompleted: projectColumns.isCompleted,
    })
    .from(tasks)
    .innerJoin(projectColumns, eq(tasks.columnId, projectColumns.id))
    .where(eq(tasks.projectId, projectId))
    .all();
}

function syncParentSummary(parentTaskId: string, fitToChildren = false): void {
  const parent = db.select().from(tasks).where(eq(tasks.id, parentTaskId)).get();
  if (!parent) return;
  const projectTasks = projectHierarchyRows(parent.projectId);
  const descendants = taskDescendants(projectTasks, parentTaskId);
  if (descendants.length === 0) return;
  const leaves = leafTasks([projectTasks.find((task) => task.id === parentTaskId)!, ...descendants])
    .filter((task) => task.id !== parentTaskId);
  const envelope = descendantEnvelope(descendants);
  const expanded = expandContainerToChildren(parent, descendants);
  const columns = db
    .select()
    .from(projectColumns)
    .where(eq(projectColumns.projectId, parent.projectId))
    .orderBy(asc(projectColumns.sortOrder))
    .all();
  const allComplete = leaves.length > 0 && leaves.every((child) => child.columnIsCompleted);
  const currentColumn = columns.find((column) => column.id === parent.columnId);
  const completedColumn = columns.find((column) => column.isCompleted);
  const activeFallback = columns.filter((column) => !column.isCompleted).at(-1);
  const columnId = allComplete
    ? completedColumn?.id ?? parent.columnId
    : currentColumn?.isCompleted
      ? activeFallback?.id ?? parent.columnId
      : parent.columnId;
  db.update(tasks)
    .set({
      startDate: fitToChildren ? envelope.startDate : expanded.startDate,
      dueDate: fitToChildren ? envelope.dueDate : expanded.dueDate,
      progress: allComplete ? 100 : weightedProgress(leaves),
      columnId,
      isMilestone: false,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, parentTaskId))
    .run();
}

function syncProjectParents(projectId: string): void {
  const rows = projectHierarchyRows(projectId);
  const parentIds = [...new Set(
    rows
      .map((task) => task.parentTaskId)
      .filter((parentTaskId): parentTaskId is string => Boolean(parentTaskId)),
  )].sort(
    (left, right) =>
      taskAncestors(rows, right).length - taskAncestors(rows, left).length,
  );
  parentIds.forEach((id) => syncParentSummary(id));
}

function syncProjectBounds(projectId: string): void {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return;
  const projectTasks = db
    .select({
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .all();
  const expanded = expandContainerToChildren(
    {
      id: project.id,
      startDate: project.plannedStartDate,
      dueDate: project.targetEndDate,
    },
    projectTasks,
  );
  if (
    expanded.startDate === project.plannedStartDate &&
    expanded.dueDate === project.targetEndDate
  ) {
    return;
  }
  db.update(projects)
    .set({
      plannedStartDate: expanded.startDate,
      targetEndDate: expanded.dueDate,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .run();
}

function syncTaskAncestors(taskId: string): void {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return;
  const rows = projectHierarchyRows(task.projectId);
  if (rows.some((candidate) => candidate.parentTaskId === taskId)) {
    syncParentSummary(taskId);
  }
  taskAncestors(rows, taskId).forEach((ancestor) => syncParentSummary(ancestor.id));
}

export async function upsertTask(input: TaskInput): Promise<{ id: string }> {
  const user = await requireUserOrThrow();
  const data = taskSchema.parse(input);
  const existing = data.id
    ? db.select().from(tasks).where(eq(tasks.id, data.id)).get()
    : undefined;
  if (data.id && !existing) throw new Error("Task not found");
  const parent = data.parentTaskId
    ? db.select().from(tasks).where(eq(tasks.id, data.parentTaskId)).get()
    : undefined;
  if (data.parentTaskId && !parent) throw new Error("Parent task not found");
  // Phase assignments are retained only as inert legacy data. New roots have no
  // phase; children inherit an existing legacy value solely for compatibility.
  const legacyPhaseId = existing?.phaseId ?? parent?.phaseId ?? null;
  const hierarchyTasks = db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      parentTaskId: tasks.parentTaskId,
      isMilestone: tasks.isMilestone,
    })
    .from(tasks)
    .all();
  assertTaskHierarchy(hierarchyTasks, {
    id: data.id ?? "__new__",
    projectId: data.projectId,
    parentTaskId: data.parentTaskId,
    isMilestone: data.isMilestone,
  });
  const existingChildren = existing
    ? db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.parentTaskId, existing.id))
        .all()
    : [];
  const parentChildren = parent
    ? db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.parentTaskId, parent.id))
        .all()
    : [];
  if (existingChildren.length > 0 && data.isMilestone) {
    throw new Error("A task with subtasks cannot become a milestone");
  }
  if (
    parent &&
    parentChildren.length === 0 &&
    existing?.parentTaskId !== parent.id &&
    taskHasDependencies(parent.id)
  ) {
    throw new Error("Reassign parent dependencies before adding subtasks");
  }
  const normalizedDueDate = data.isMilestone ? data.startDate : data.dueDate;
  if (data.startDate && normalizedDueDate && normalizedDueDate < data.startDate) {
    throw new Error("Due date precedes start date");
  }

  const targetColumn = db
    .select({
      projectId: projectColumns.projectId,
      isCompleted: projectColumns.isCompleted,
    })
    .from(projectColumns)
    .where(eq(projectColumns.id, data.columnId))
    .get();
  if (!targetColumn) throw new Error("Column not found");
  if (targetColumn.projectId !== data.projectId) {
    throw new Error("Column belongs to another project");
  }
  if (
    existingChildren.length > 0 &&
    targetColumn.isCompleted &&
    leafTasks(
      taskDescendants(projectHierarchyRows(data.projectId), existing!.id),
    ).some((child) => !child.columnIsCompleted)
  ) {
    throw new Error("Complete all subtasks before completing the parent");
  }
  const values = {
    title: data.title,
    description: data.description,
    assigneeId: data.assigneeId,
    dueDate: normalizedDueDate,
    startDate: data.startDate,
    phaseId: legacyPhaseId,
    parentTaskId: data.parentTaskId,
    progress: targetColumn.isCompleted ? 100 : data.progress,
    isMilestone: data.isMilestone,
    priority: data.priority,
    updatedAt: new Date(),
  };

  let id = data.id;
  db.transaction(() => {
    if (id && existing) {
      const movedScope =
        existing.columnId !== data.columnId ||
        existing.parentTaskId !== data.parentTaskId;
      db.update(tasks)
        .set({
          ...values,
          columnId: data.columnId,
          sortOrder: movedScope
            ? nextSortOrder(data.columnId, data.parentTaskId)
            : existing.sortOrder,
        })
        .where(eq(tasks.id, id))
        .run();
    } else {
      const row = db
        .insert(tasks)
        .values({
          ...values,
          projectId: data.projectId,
          columnId: data.columnId,
          sortOrder: nextSortOrder(data.columnId, data.parentTaskId),
          createdBy: user.id,
        })
        .returning({ id: tasks.id })
        .get();
      id = row.id;
    }
    const affectedParents = new Set(
      [existing?.parentTaskId, data.parentTaskId].filter(
        (parentTaskId): parentTaskId is string => Boolean(parentTaskId),
      ),
    );
    affectedParents.forEach(syncTaskAncestors);
    if (id && existingChildren.length > 0) syncParentSummary(id);
    syncProjectBounds(data.projectId);
  });

  revalidatePath(`/projects/${data.projectId}`);
  revalidatePath("/projects");
  if (!id) throw new Error("Task was not saved");
  return { id };
}

export async function deleteTask(id: string) {
  await requireUserOrThrow();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return;
  db.transaction(() => {
    db.delete(tasks).where(eq(tasks.id, id)).run();
    if (task.parentTaskId) syncTaskAncestors(task.parentTaskId);
    syncProjectBounds(task.projectId);
  });
  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/projects");
}

export async function fitTaskToChildren(taskId: string) {
  await requireUserOrThrow();
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw new Error("Task not found");
  const descendants = taskDescendants(projectHierarchyRows(task.projectId), taskId);
  if (descendants.length === 0) throw new Error("Task has no child schedule");
  const envelope = descendantEnvelope(descendants);
  if (!envelope.startDate || !envelope.dueDate) {
    throw new Error("Schedule at least one child before fitting the parent");
  }
  db.update(tasks)
    .set({
      startDate: envelope.startDate,
      dueDate: envelope.dueDate,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .run();
  syncTaskAncestors(taskId);
  syncProjectBounds(task.projectId);
  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/projects");
}

export async function fitProjectToTasks(projectId: string) {
  await requireUserOrThrow();
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw new Error("Project not found");
  const projectTasks = db
    .select({ startDate: tasks.startDate, dueDate: tasks.dueDate })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .all();
  const envelope = descendantEnvelope(projectTasks);
  if (!envelope.startDate || !envelope.dueDate) {
    throw new Error("Schedule at least one task before fitting the project");
  }
  db.update(projects)
    .set({
      plannedStartDate: envelope.startDate,
      targetEndDate: envelope.dueDate,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .run();
  revalidatePath("/projects");
}

const moveSchema = z.object({
  taskId: z.string().min(1),
  columnId: z.string().min(1),
  /** Task id to insert after, or null for the top of the column. */
  afterTaskId: z.string().nullable(),
});

/** Persists a drag-and-drop move with gap-based ordering; renumbers on collision. */
export async function moveTask(input: z.infer<typeof moveSchema>) {
  await requireUserOrThrow();
  const data = moveSchema.parse(input);

  const task = db.select().from(tasks).where(eq(tasks.id, data.taskId)).get();
  if (!task) throw new Error("Task not found");
  const targetColumn = db
    .select({ isCompleted: projectColumns.isCompleted })
    .from(projectColumns)
    .where(eq(projectColumns.id, data.columnId))
    .get();
  if (!targetColumn) throw new Error("Column not found");
  const descendants = taskDescendants(projectHierarchyRows(task.projectId), task.id);
  const children = leafTasks(descendants);
  if (
    children.length > 0 &&
    targetColumn.isCompleted &&
    children.some((child) => !child.columnIsCompleted)
  ) {
    throw new Error("Complete all subtasks before completing the parent");
  }

  const columnTasks = db
    .select({ id: tasks.id, sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(
      and(
        eq(tasks.columnId, data.columnId),
        task.parentTaskId
          ? eq(tasks.parentTaskId, task.parentTaskId)
          : isNull(tasks.parentTaskId),
        sql`${tasks.id} != ${data.taskId}`,
      ),
    )
    .orderBy(asc(tasks.sortOrder))
    .all();

  const afterIndex = data.afterTaskId
    ? columnTasks.findIndex((t) => t.id === data.afterTaskId)
    : -1;
  const prev = afterIndex >= 0 ? columnTasks[afterIndex] : null;
  const next =
    afterIndex + 1 < columnTasks.length ? columnTasks[afterIndex + 1] : null;

  let sortOrder: number;
  if (prev && next) sortOrder = Math.floor((prev.sortOrder + next.sortOrder) / 2);
  else if (prev) sortOrder = prev.sortOrder + SORT_GAP;
  else if (next) sortOrder = Math.floor(next.sortOrder / 2);
  else sortOrder = SORT_GAP;

  const collision =
    (prev && sortOrder <= prev.sortOrder) || (next && sortOrder >= next.sortOrder);

  if (collision) {
    // Renumber the whole column with fresh gaps, then place the task.
    const ordered = [...columnTasks];
    ordered.splice(afterIndex + 1, 0, { id: data.taskId, sortOrder: 0 });
    db.transaction((tx) => {
      ordered.forEach((t, index) => {
        tx.update(tasks)
          .set({
            sortOrder: (index + 1) * SORT_GAP,
            columnId: data.columnId,
            ...(targetColumn.isCompleted ? { progress: 100 } : {}),
          })
          .where(eq(tasks.id, t.id))
          .run();
      });
    });
  } else {
    db.update(tasks)
      .set({
        columnId: data.columnId,
        sortOrder,
        ...(targetColumn.isCompleted ? { progress: 100 } : {}),
      })
      .where(eq(tasks.id, data.taskId))
      .run();
  }

  if (task.parentTaskId) syncTaskAncestors(task.id);
  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/projects");
}

// --- Finish-to-start dependencies ---

const dependencySchema = z.object({
  id: z.string().optional(),
  predecessorTaskId: z.string().min(1),
  successorTaskId: z.string().min(1),
  lagWorkdays: z.number().int().min(-365).max(365).default(0),
});

export async function upsertTaskDependency(
  input: z.infer<typeof dependencySchema>,
) {
  await requireUserOrThrow();
  const data = dependencySchema.parse(input);
  if (data.predecessorTaskId === data.successorTaskId) {
    throw new Error("A task cannot depend on itself");
  }
  const summaryEndpoint = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      or(
        eq(tasks.parentTaskId, data.predecessorTaskId),
        eq(tasks.parentTaskId, data.successorTaskId),
      ),
    )
    .get();
  if (summaryEndpoint) {
    throw new Error("Dependencies can only connect leaf tasks");
  }
  const taskIds = db.select({ id: tasks.id }).from(tasks).all().map((row) => row.id);
  const existing = db.select().from(taskDependencies).all();
  const candidate = [
    ...existing.filter((dependency) => dependency.id !== data.id),
    {
      predecessorTaskId: data.predecessorTaskId,
      successorTaskId: data.successorTaskId,
      lagWorkdays: data.lagWorkdays,
    },
  ];
  if (hasDependencyCycle(taskIds, candidate)) {
    throw new Error("Dependency cycle");
  }
  if (data.id) {
    db.update(taskDependencies)
      .set({
        predecessorTaskId: data.predecessorTaskId,
        successorTaskId: data.successorTaskId,
        lagWorkdays: data.lagWorkdays,
      })
      .where(eq(taskDependencies.id, data.id))
      .run();
  } else {
    const duplicate = existing.some(
      (dependency) =>
        dependency.predecessorTaskId === data.predecessorTaskId &&
        dependency.successorTaskId === data.successorTaskId,
    );
    if (!duplicate) {
      db.insert(taskDependencies).values(data).run();
    }
  }
  revalidatePath("/projects");
}

export async function deleteTaskDependency(id: string) {
  await requireUserOrThrow();
  db.delete(taskDependencies).where(eq(taskDependencies.id, id)).run();
  revalidatePath("/projects");
}

// --- Authoritative schedule previews, applies, and undo ---

const scheduleMoveSchema = z.object({
  entityType: z.enum(["task", "project"]).optional().default("task"),
  entityId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operation: z
    .enum(["move", "resize-start", "resize-end", "place"])
    .optional()
    .default("move"),
}).superRefine((data, context) => {
  const id =
    data.entityId ??
    (data.entityType === "project" ? data.projectId : data.taskId);
  if (!id) {
    context.addIssue({
      code: "custom",
      path: ["entityId"],
      message: "A schedule entity is required",
    });
  }
});
const scheduleChangeSchema = z.object({
  entityType: z.enum(["task", "project"]),
  entityId: z.string().min(1),
  beforeStartDate: z.string().nullable(),
  beforeDueDate: z.string().nullable(),
  afterStartDate: z.string().nullable(),
  afterDueDate: z.string().nullable(),
});
const scheduleApplySchema = scheduleMoveSchema.extend({
  expectedChanges: z.array(scheduleChangeSchema).min(1),
});

type PortfolioScheduleChange = z.infer<typeof scheduleChangeSchema>;

function scheduleEntityId(input: z.infer<typeof scheduleMoveSchema>): string {
  const id =
    input.entityId ??
    (input.entityType === "project" ? input.projectId : input.taskId);
  if (!id) throw new Error("A schedule entity is required");
  return id;
}

function computeSchedulePreview(
  input: z.infer<typeof scheduleMoveSchema>,
): PortfolioScheduleChange[] {
  const taskRows = db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      parentTaskId: tasks.parentTaskId,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      progress: tasks.progress,
      isMilestone: tasks.isMilestone,
    })
    .from(tasks)
    .all();
  const projectRows = db
    .select({
      id: projects.id,
      name: projects.name,
      startDate: projects.plannedStartDate,
      dueDate: projects.targetEndDate,
    })
    .from(projects)
    .all();
  const entityId = scheduleEntityId(input);
  const original = new Map(taskRows.map((task) => [task.id, { ...task }]));
  const working = new Map(taskRows.map((task) => [task.id, { ...task }]));
  const originalProjects = new Map(
    projectRows.map((project) => [project.id, { ...project }]),
  );
  const explicitProjectBounds = new Map<
    string,
    { startDate: string; dueDate: string }
  >();
  const leaves = leafTasks(taskRows);
  const leafIds = new Set(leaves.map((task) => task.id));
  const dependencies = db
    .select()
    .from(taskDependencies)
    .all()
    .filter(
      (dependency) =>
        leafIds.has(dependency.predecessorTaskId) &&
        leafIds.has(dependency.successorTaskId),
    );
  const applyCascade = (rootTaskId: string, startDate: string, dueDate: string) => {
    const currentLeaves = leaves.map((leaf) => working.get(leaf.id)!);
    for (const change of previewScheduleCascade(currentLeaves, dependencies, {
      taskId: rootTaskId,
      startDate,
      dueDate,
    })) {
      const task = working.get(change.taskId)!;
      working.set(change.taskId, {
        ...task,
        startDate: change.afterStartDate,
        dueDate: change.afterDueDate,
      });
    }
  };

  const normalizedStart = normalizeToWorkday(input.startDate);
  const normalizedDue = normalizeToWorkday(input.dueDate, "backward");
  if (normalizedDue < normalizedStart) {
    throw new Error("Due date precedes start date");
  }

  if (input.entityType === "project") {
    const project = projectRows.find((candidate) => candidate.id === entityId);
    if (!project) throw new Error("Project not found");
    const projectTasks = taskRows.filter((task) => task.projectId === project.id);
    let desiredBounds = {
      startDate: normalizedStart,
      dueDate: normalizedDue,
    };
    if (input.operation === "move" && projectTasks.length > 0) {
      const envelope = descendantEnvelope(projectTasks);
      const currentStart = project.startDate ?? envelope.startDate;
      if (!currentStart) throw new Error("Place the project before moving it");
      const offset = workdayDistance(currentStart, normalizedStart);
      for (const task of shiftScheduledTasks(projectTasks, offset)) {
        working.set(task.id, { ...working.get(task.id)!, ...task });
      }
      for (const leaf of leafTasks(projectTasks)) {
        const shifted = working.get(leaf.id)!;
        if (shifted.startDate && shifted.dueDate) {
          applyCascade(leaf.id, shifted.startDate, shifted.dueDate);
        }
      }
    } else if (input.operation !== "place") {
      const constraint = clampContainerToChildren(
        desiredBounds,
        projectTasks.map((task) => working.get(task.id)!),
      );
      desiredBounds = {
        startDate: constraint.startDate ?? normalizedStart,
        dueDate: constraint.dueDate ?? normalizedDue,
      };
    }
    explicitProjectBounds.set(project.id, desiredBounds);
  } else {
    const target = taskRows.find((task) => task.id === entityId);
    if (!target) throw new Error("Task not found");
    const descendants = taskDescendants(taskRows, target.id);
    const targetHasChildren = descendants.length > 0;
    if (targetHasChildren && input.operation === "move") {
      if (!target.startDate) {
        throw new Error("Place the parent before moving its subtree");
      }
      const offset = workdayDistance(target.startDate, normalizedStart);
      const subtree = [target, ...descendants];
      for (const task of shiftScheduledTasks(subtree, offset)) {
        working.set(task.id, { ...working.get(task.id)!, ...task });
      }
      for (const leaf of leafTasks(subtree)) {
        const shifted = working.get(leaf.id)!;
        if (shifted.startDate && shifted.dueDate) {
          applyCascade(leaf.id, shifted.startDate, shifted.dueDate);
        }
      }
    } else if (targetHasChildren) {
      const constraint = clampContainerToChildren(
        { startDate: normalizedStart, dueDate: normalizedDue },
        descendants.map((task) => working.get(task.id)!),
      );
      working.set(target.id, {
        ...target,
        startDate: constraint.startDate,
        dueDate: constraint.dueDate,
      });
    } else {
      applyCascade(target.id, normalizedStart, normalizedDue);
    }
  }

  const changedIds = new Set(
    taskRows
      .filter((task) => {
        const after = working.get(task.id)!;
        return task.startDate !== after.startDate || task.dueDate !== after.dueDate;
      })
      .map((task) => task.id),
  );
  const ancestorIds = new Set<string>();
  for (const id of changedIds) {
    for (const ancestor of taskAncestors(taskRows, id)) ancestorIds.add(ancestor.id);
  }
  const ancestorsDeepestFirst = [...ancestorIds].sort(
    (left, right) =>
      taskAncestors(taskRows, right).length - taskAncestors(taskRows, left).length,
  );
  for (const ancestorId of ancestorsDeepestFirst) {
    const ancestor = working.get(ancestorId)!;
    const expansion = expandContainerToChildren(
      ancestor,
      taskDescendants(taskRows, ancestorId).map((task) => working.get(task.id)!),
    );
    working.set(ancestorId, {
      ...ancestor,
      startDate: expansion.startDate,
      dueDate: expansion.dueDate,
    });
  }

  const taskChanges: PortfolioScheduleChange[] = taskRows.flatMap((task) => {
    const before = original.get(task.id)!;
    const after = working.get(task.id)!;
    return before.startDate === after.startDate && before.dueDate === after.dueDate
      ? []
      : [{
          entityType: "task" as const,
          entityId: task.id,
          beforeStartDate: before.startDate,
          beforeDueDate: before.dueDate,
          afterStartDate: after.startDate,
          afterDueDate: after.dueDate,
        }];
  });

  const affectedProjectIds = new Set(
    taskChanges.map(
      (change) => original.get(change.entityId)?.projectId,
    ).filter((projectId): projectId is string => Boolean(projectId)),
  );
  explicitProjectBounds.forEach((_, projectId) => affectedProjectIds.add(projectId));
  const projectChanges: PortfolioScheduleChange[] = projectRows.flatMap((project) => {
    if (!affectedProjectIds.has(project.id)) return [];
    const before = originalProjects.get(project.id)!;
    const base = explicitProjectBounds.get(project.id) ?? {
      startDate: before.startDate,
      dueDate: before.dueDate,
    };
    const after = expandContainerToChildren(
      { id: project.id, ...base },
      taskRows
        .filter((task) => task.projectId === project.id)
        .map((task) => working.get(task.id)!),
    );
    return before.startDate === after.startDate && before.dueDate === after.dueDate
      ? []
      : [{
          entityType: "project" as const,
          entityId: project.id,
          beforeStartDate: before.startDate,
          beforeDueDate: before.dueDate,
          afterStartDate: after.startDate,
          afterDueDate: after.dueDate,
        }];
  });
  return [...taskChanges, ...projectChanges];
}

export async function previewPortfolioScheduleChange(
  input: z.infer<typeof scheduleMoveSchema>,
) {
  await requireUserOrThrow();
  const data = scheduleMoveSchema.parse(input);
  const changes = computeSchedulePreview(data);
  const taskIds = changes
    .filter((change) => change.entityType === "task")
    .map((change) => change.entityId);
  const projectIds = changes
    .filter((change) => change.entityType === "project")
    .map((change) => change.entityId);
  const titles = [
    ...(taskIds.length === 0
      ? []
      : db
          .select({ id: tasks.id, title: tasks.title })
          .from(tasks)
          .where(inArray(tasks.id, taskIds))
          .all()),
    ...(projectIds.length === 0
      ? []
      : db
          .select({ id: projects.id, title: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
          .all()),
  ];
  const titleById = new Map(titles.map((entity) => [entity.id, entity.title]));
  return changes.map((change) => ({
    ...change,
    title: titleById.get(change.entityId) ?? "",
  }));
}

export async function applyPortfolioScheduleChange(
  input: z.infer<typeof scheduleApplySchema>,
) {
  const user = await requireUserOrThrow();
  const data = scheduleApplySchema.parse(input);
  const changes = computeSchedulePreview(data);
  if (JSON.stringify(changes) !== JSON.stringify(data.expectedChanges)) {
    throw new Error("Schedule changed while the preview was open");
  }
  if (changes.length === 0) return { changeSetId: null, changes };

  const result = db.transaction((tx) => {
    const changeSet = tx
      .insert(scheduleChangeSets)
      .values({ createdBy: user.id })
      .returning({ id: scheduleChangeSets.id })
      .get();
    const taskChanges = changes.filter(
      (change) => change.entityType === "task",
    );
    const projectChanges = changes.filter(
      (change) => change.entityType === "project",
    );
    if (taskChanges.length > 0) {
      tx.insert(scheduleChangeItems)
        .values(
          taskChanges.map((change) => ({
          changeSetId: changeSet.id,
          taskId: change.entityId,
          beforeStartDate: change.beforeStartDate,
          beforeDueDate: change.beforeDueDate,
          afterStartDate: change.afterStartDate,
          afterDueDate: change.afterDueDate,
          })),
        )
        .run();
    }
    if (projectChanges.length > 0) {
      tx.insert(projectScheduleChangeItems)
        .values(
          projectChanges.map((change) => ({
            changeSetId: changeSet.id,
            projectId: change.entityId,
            beforeStartDate: change.beforeStartDate,
            beforeDueDate: change.beforeDueDate,
            afterStartDate: change.afterStartDate,
            afterDueDate: change.afterDueDate,
          })),
        )
        .run();
    }
    for (const change of taskChanges) {
      const current = tx
        .select({
          startDate: tasks.startDate,
          dueDate: tasks.dueDate,
        })
        .from(tasks)
        .where(eq(tasks.id, change.entityId))
        .get();
      if (
        !current ||
        current.startDate !== change.beforeStartDate ||
        current.dueDate !== change.beforeDueDate
      ) {
        throw new Error("Schedule changed while the preview was open");
      }
      tx.update(tasks)
        .set({
          startDate: change.afterStartDate,
          dueDate: change.afterDueDate,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, change.entityId))
        .run();
    }
    for (const change of projectChanges) {
      const current = tx
        .select({
          startDate: projects.plannedStartDate,
          dueDate: projects.targetEndDate,
        })
        .from(projects)
        .where(eq(projects.id, change.entityId))
        .get();
      if (
        !current ||
        current.startDate !== change.beforeStartDate ||
        current.dueDate !== change.beforeDueDate
      ) {
        throw new Error("Schedule changed while the preview was open");
      }
      tx.update(projects)
        .set({
          plannedStartDate: change.afterStartDate,
          targetEndDate: change.afterDueDate,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, change.entityId))
        .run();
    }
    return { changeSetId: changeSet.id, changes };
  });
  revalidatePath("/projects");
  return result;
}

export async function revertPortfolioScheduleChange(changeSetId: string) {
  await requireUserOrThrow();
  const set = db
    .select()
    .from(scheduleChangeSets)
    .where(eq(scheduleChangeSets.id, changeSetId))
    .get();
  if (!set || set.status !== "applied") throw new Error("Change cannot be undone");
  const items = db
    .select()
    .from(scheduleChangeItems)
    .where(eq(scheduleChangeItems.changeSetId, changeSetId))
    .all();
  const projectItems = db
    .select()
    .from(projectScheduleChangeItems)
    .where(eq(projectScheduleChangeItems.changeSetId, changeSetId))
    .all();
  db.transaction((tx) => {
    for (const item of items) {
      const current = tx
        .select({
          startDate: tasks.startDate,
          dueDate: tasks.dueDate,
        })
        .from(tasks)
        .where(eq(tasks.id, item.taskId))
        .get();
      if (
        !current ||
        current.startDate !== item.afterStartDate ||
        current.dueDate !== item.afterDueDate
      ) {
        throw new Error("A later edit prevents undo");
      }
      tx.update(tasks)
        .set({
          startDate: item.beforeStartDate,
          dueDate: item.beforeDueDate,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, item.taskId))
        .run();
    }
    for (const item of projectItems) {
      const current = tx
        .select({
          startDate: projects.plannedStartDate,
          dueDate: projects.targetEndDate,
        })
        .from(projects)
        .where(eq(projects.id, item.projectId))
        .get();
      if (
        !current ||
        current.startDate !== item.afterStartDate ||
        current.dueDate !== item.afterDueDate
      ) {
        throw new Error("A later edit prevents undo");
      }
      tx.update(projects)
        .set({
          plannedStartDate: item.beforeStartDate,
          targetEndDate: item.beforeDueDate,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, item.projectId))
        .run();
    }
    tx.update(scheduleChangeSets)
      .set({ status: "reverted", revertedAt: new Date() })
      .where(eq(scheduleChangeSets.id, changeSetId))
      .run();
  });
  revalidatePath("/projects");
}
