"use server";

import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  projectColumns,
  projectScheduleChangeItems,
  projects,
  scheduleChangeItems,
  scheduleChangeSets,
  scheduleConstraintTypes,
  taskDependencies,
  tasks,
} from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import {
  assertDependencyEndpoints,
  assertTaskHierarchy,
  dependencyConflictEdgeKeys,
  expandContainerEnvelope,
  hasScheduleCycle,
  inferScheduleEditOperation,
  leafTasks,
  previewScheduleEdit,
  scheduleContainmentViolations,
  type ScheduleEntityChange,
  type SchedulePreview,
  taskAncestors,
  taskDescendants,
  weightedProgress,
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
    const projectId = data.id;
    const existing = db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!existing) throw new Error("Project not found");
    const scheduleDatesChanged =
      existing.plannedStartDate !== data.plannedStartDate ||
      existing.targetEndDate !== data.targetEndDate;
    const schedulesProject = Boolean(
      data.plannedStartDate && data.targetEndDate && scheduleDatesChanged,
    );
    const operation =
      data.plannedStartDate && data.targetEndDate
        ? inferScheduleEditOperation(
            {
              startDate: existing.plannedStartDate,
              dueDate: existing.targetEndDate,
            },
            {
              startDate: data.plannedStartDate,
              dueDate: data.targetEndDate,
            },
          )
        : "place" as const;

    db.transaction((tx) => {
      // Keep the old dates until the shared planner has read them, while
      // persisting unrelated project edits in the same transaction.
      tx.update(projects)
        .set({
          name: data.name,
          description: data.description,
          color: data.color,
          managerId: data.managerId,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId))
        .run();
      if (
        schedulesProject &&
        data.plannedStartDate &&
        data.targetEndDate
      ) {
        const preview = computeSchedulePreview(
          {
            entityType: "project",
            entityId: projectId,
            operation,
            startDate: data.plannedStartDate,
            dueDate: data.targetEndDate,
          },
          tx,
        );
        for (const change of preview.changes) {
          if (change.entityType === "task") {
            tx.update(tasks)
              .set({
                startDate: change.afterStartDate,
                dueDate: change.afterDueDate,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, change.entityId))
              .run();
          } else {
            tx.update(projects)
              .set({
                plannedStartDate: change.afterStartDate,
                targetEndDate: change.afterDueDate,
                updatedAt: new Date(),
              })
              .where(eq(projects.id, change.entityId))
              .run();
          }
        }
      } else if (scheduleDatesChanged) {
        tx.update(projects)
          .set({
            plannedStartDate: data.plannedStartDate,
            targetEndDate: data.targetEndDate,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, projectId))
          .run();
      }
      syncProjectBounds(projectId);
    });
    revalidatePath("/projects");
    return db.select().from(projects).where(eq(projects.id, projectId)).get()!;
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
  constraintType: z.enum(scheduleConstraintTypes).optional().default("asap"),
  constraintDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
}).superRefine((data, context) => {
  if (
    (data.startDate && !data.dueDate && !data.isMilestone) ||
    (!data.startDate && data.dueDate)
  ) {
    context.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "Start and due date must be scheduled together",
    });
  }
  if (data.constraintType === "must_start_on" && !data.constraintDate) {
    context.addIssue({
      code: "custom",
      path: ["constraintDate"],
      message: "A fixed start needs a date",
    });
  }
});

// The pre-parse shape, so callers may omit anything the schema defaults.
export type TaskInput = z.input<typeof taskSchema>;

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

/**
 * Expands a summary around its children while preserving any authored slack.
 * Callers work deepest-first so every parent sees already-contained children.
 */
function syncParentSummary(parentTaskId: string): void {
  const parent = db.select().from(tasks).where(eq(tasks.id, parentTaskId)).get();
  if (!parent) return;
  const projectTasks = projectHierarchyRows(parent.projectId);
  const descendants = taskDescendants(projectTasks, parentTaskId);
  if (descendants.length === 0) return;
  const leaves = leafTasks([projectTasks.find((task) => task.id === parentTaskId)!, ...descendants])
    .filter((task) => task.id !== parentTaskId);
  const children = projectTasks.filter((task) => task.parentTaskId === parentTaskId);
  const envelope = expandContainerEnvelope(parent, children);
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
      startDate: envelope.startDate,
      dueDate: envelope.dueDate,
      progress: allComplete ? 100 : weightedProgress(leaves),
      columnId,
      isMilestone: false,
      // A summary's dates are derived, so a constraint on it would never apply.
      constraintType: "asap",
      constraintDate: null,
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

/** Expands a project around all scheduled work without ever shrinking it. */
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
  const envelope = expandContainerEnvelope(
    {
      id: project.id,
      startDate: project.plannedStartDate,
      dueDate: project.targetEndDate,
    },
    projectTasks,
  );
  const plannedStartDate = envelope.startDate;
  const targetEndDate = envelope.dueDate;
  if (
    plannedStartDate === project.plannedStartDate &&
    targetEndDate === project.targetEndDate
  ) {
    return;
  }
  db.update(projects)
    .set({
      plannedStartDate,
      targetEndDate,
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
  const promotesParent = Boolean(parent) && parentChildren.length === 0 &&
    existing?.parentTaskId !== parent?.id;
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
    phaseId: legacyPhaseId,
    parentTaskId: data.parentTaskId,
    progress: targetColumn.isCompleted ? 100 : data.progress,
    isMilestone: data.isMilestone,
    // Only leaves carry constraints; a summary's dates come from its children.
    constraintType: existingChildren.length > 0 ? "asap" as const : data.constraintType,
    constraintDate: existingChildren.length > 0 ? null : data.constraintDate,
    priority: data.priority,
    updatedAt: new Date(),
  };
  const scheduleDatesChanged = Boolean(
    existing &&
      (existing.startDate !== data.startDate ||
        existing.dueDate !== normalizedDueDate),
  );
  const schedulesExistingTask = Boolean(
    existing && data.startDate && normalizedDueDate && scheduleDatesChanged,
  );
  const scheduleOperation =
    existing &&
    data.startDate &&
    normalizedDueDate
      ? inferScheduleEditOperation(existing, {
          startDate: data.startDate,
          dueDate: normalizedDueDate,
        })
      : "place" as const;

  let id = data.id;
  db.transaction((tx) => {
    if (promotesParent && parent) {
      tx.update(tasks)
        .set({ constraintType: "asap", constraintDate: null, updatedAt: new Date() })
        .where(eq(tasks.id, parent.id))
        .run();
    }
    if (id && existing) {
      const movedScope =
        existing.columnId !== data.columnId ||
        existing.parentTaskId !== data.parentTaskId;
      // Persist non-date fields first. The shared planner then reads the new
      // hierarchy/constraint state while the old dates are still available as
      // its concurrency baseline.
      tx.update(tasks)
        .set({
          ...values,
          columnId: data.columnId,
          sortOrder: movedScope
            ? nextSortOrder(data.columnId, data.parentTaskId)
            : existing.sortOrder,
        })
        .where(eq(tasks.id, id))
        .run();
      if (schedulesExistingTask && data.startDate && normalizedDueDate) {
        const preview = computeSchedulePreview(
          {
            entityType: "task",
            entityId: id,
            operation: scheduleOperation,
            startDate: data.startDate,
            dueDate: normalizedDueDate,
          },
          tx,
        );
        for (const change of preview.changes) {
          if (change.entityType === "task") {
            tx.update(tasks)
              .set({
                startDate: change.afterStartDate,
                dueDate: change.afterDueDate,
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, change.entityId))
              .run();
          } else {
            tx.update(projects)
              .set({
                plannedStartDate: change.afterStartDate,
                targetEndDate: change.afterDueDate,
                updatedAt: new Date(),
              })
              .where(eq(projects.id, change.entityId))
              .run();
          }
        }
      } else if (scheduleDatesChanged) {
        // Clearing a leaf schedule has no dependency floor to cascade. Parent
        // and project containers intentionally retain their current slack.
        tx.update(tasks)
          .set({
            startDate: data.startDate,
            dueDate: normalizedDueDate,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, id))
          .run();
      }
    } else {
      const row = tx
        .insert(tasks)
        .values({
          ...values,
          startDate: data.startDate,
          dueDate: normalizedDueDate,
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

const reparentSchema = z.object({
  taskId: z.string().min(1),
  parentTaskId: z.string().nullable().default(null),
  beforeTaskId: z.string().nullable().optional().default(null),
});

/**
 * Moves a task to a new parent and position (R5), used by indent/outdent and by
 * dragging rows in the tree pane. Both the old and the new parent are rolled up
 * afterwards, so a summary that just lost its last child keeps the dates it had
 * and becomes an ordinary task again.
 */
export async function reparentTask(input: z.input<typeof reparentSchema>) {
  await requireUserOrThrow();
  const data = reparentSchema.parse(input);
  const task = db.select().from(tasks).where(eq(tasks.id, data.taskId)).get();
  if (!task) throw new Error("Task not found");
  if (data.parentTaskId === task.parentTaskId) return;

  const projectTasks = projectHierarchyRows(task.projectId);
  assertTaskHierarchy(
    projectTasks.map((row) => ({
      id: row.id,
      projectId: task.projectId,
      parentTaskId: row.parentTaskId,
      isMilestone: row.isMilestone,
    })),
    {
      id: task.id,
      projectId: task.projectId,
      parentTaskId: data.parentTaskId,
      isMilestone: task.isMilestone,
    },
  );
  if (taskDescendants(projectTasks, task.id).length > 0 && task.isMilestone) {
    throw new Error("Milestones cannot contain subtasks");
  }

  const siblings = db
    .select({ id: tasks.id, sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, task.projectId),
        data.parentTaskId
          ? eq(tasks.parentTaskId, data.parentTaskId)
          : isNull(tasks.parentTaskId),
      ),
    )
    .orderBy(asc(tasks.sortOrder))
    .all()
    .filter((sibling) => sibling.id !== task.id);
  const anchor = data.beforeTaskId
    ? siblings.findIndex((sibling) => sibling.id === data.beforeTaskId)
    : -1;
  const sortOrder =
    anchor === 0
      ? siblings[0].sortOrder - SORT_GAP
      : anchor > 0
        ? Math.round((siblings[anchor - 1].sortOrder + siblings[anchor].sortOrder) / 2)
        : (siblings.at(-1)?.sortOrder ?? 0) + SORT_GAP;

  db.transaction(() => {
    db.update(tasks)
      .set({
        parentTaskId: data.parentTaskId,
        sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, task.id))
      .run();
    if (data.parentTaskId) {
      db.update(tasks)
        .set({ constraintType: "asap", constraintDate: null, updatedAt: new Date() })
        .where(eq(tasks.id, data.parentTaskId))
        .run();
      syncTaskAncestors(data.parentTaskId);
    }
    if (task.parentTaskId) syncTaskAncestors(task.parentTaskId);
    syncTaskAncestors(task.id);
    syncProjectBounds(task.projectId);
  });

  revalidatePath(`/projects/${task.projectId}`);
  revalidatePath("/projects");
}

export async function fitProjectToTasks(projectId: string) {
  return applyPortfolioScheduleChange({
    entityType: "project",
    entityId: projectId,
    operation: "fit",
  });
}

export async function fitTaskToChildren(taskId: string) {
  return applyPortfolioScheduleChange({
    entityType: "task",
    entityId: taskId,
    operation: "fit",
  });
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
  // Summary tasks may sit at either end of a link (R6). A link between a task
  // and its own ancestor or descendant is still impossible, because a summary
  // already spans its subtree.
  const hierarchyTasks = db
    .select({ id: tasks.id, parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .all();
  assertDependencyEndpoints(hierarchyTasks, data);
  const existing = db.select().from(taskDependencies).all();
  const candidate = [
    ...existing.filter((dependency) => dependency.id !== data.id),
    {
      predecessorTaskId: data.predecessorTaskId,
      successorTaskId: data.successorTaskId,
      lagWorkdays: data.lagWorkdays,
    },
  ];
  if (hasScheduleCycle(hierarchyTasks, candidate)) {
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
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  operation: z
    .enum(["move", "resize-start", "resize-end", "place", "fit"])
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
  if (
    data.operation !== "fit" &&
    (!data.startDate || !data.dueDate)
  ) {
    context.addIssue({
      code: "custom",
      path: ["startDate"],
      message: "Schedule dates are required",
    });
  }
});

const expectedScheduleChangeSchema = z.object({
  entityType: z.enum(["task", "project"]),
  entityId: z.string().min(1),
  beforeStartDate: z.string().nullable(),
  beforeDueDate: z.string().nullable(),
  afterStartDate: z.string().nullable(),
  afterDueDate: z.string().nullable(),
  cause: z
    .enum(["direct", "fit", "subtree", "dependency", "ancestor-expansion"])
    .optional(),
});

const scheduleApplySchema = scheduleMoveSchema.and(
  z.object({
    expectedPreview: z
      .object({
        changes: z.array(expectedScheduleChangeSchema),
      })
      .optional(),
  }),
);

export type PortfolioScheduleEditInput = z.input<typeof scheduleMoveSchema>;

function scheduleEntityId(input: z.infer<typeof scheduleMoveSchema>): string {
  const id =
    input.entityId ??
    (input.entityType === "project" ? input.projectId : input.taskId);
  if (!id) throw new Error("A schedule entity is required");
  return id;
}

type ScheduleReader = Pick<typeof db, "select">;

/**
 * The projects a schedule edit can reach: the one being edited plus any joined
 * to it by a dependency. Everything outside that set is untouchable, so there is
 * no reason to load it.
 */
function scheduleScope(
  reader: ScheduleReader,
  projectId: string,
  dependencies: { predecessorTaskId: string; successorTaskId: string }[],
): Set<string> {
  const projectByTask = new Map(
    reader
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .all()
      .map((task) => [task.id, task.projectId]),
  );
  const scope = new Set([projectId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const dependency of dependencies) {
      const from = projectByTask.get(dependency.predecessorTaskId);
      const to = projectByTask.get(dependency.successorTaskId);
      if (!from || !to || from === to) continue;
      if (scope.has(from) && !scope.has(to)) {
        scope.add(to);
        grew = true;
      } else if (scope.has(to) && !scope.has(from)) {
        scope.add(from);
        grew = true;
      }
    }
  }
  return scope;
}

function computeSchedulePreview(
  input: z.infer<typeof scheduleMoveSchema>,
  reader: ScheduleReader = db,
): SchedulePreview {
  const entityId = scheduleEntityId(input);
  const dependencies = reader.select().from(taskDependencies).all();
  const rootProjectId =
    input.entityType === "project"
      ? entityId
      : reader
          .select({ projectId: tasks.projectId })
          .from(tasks)
          .where(eq(tasks.id, entityId))
          .get()?.projectId;
  if (!rootProjectId) throw new Error("Task not found");
  const scope = scheduleScope(reader, rootProjectId, dependencies);
  const scopeIds = [...scope];

  const taskRows = reader
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      parentTaskId: tasks.parentTaskId,
      startDate: tasks.startDate,
      dueDate: tasks.dueDate,
      progress: tasks.progress,
      isMilestone: tasks.isMilestone,
      constraintType: tasks.constraintType,
      constraintDate: tasks.constraintDate,
    })
    .from(tasks)
    .where(inArray(tasks.projectId, scopeIds))
    .all();
  const projectRows = reader
    .select({
      id: projects.id,
      name: projects.name,
      startDate: projects.plannedStartDate,
      dueDate: projects.targetEndDate,
    })
    .from(projects)
    .where(inArray(projects.id, scopeIds))
    .all();
  const taskIdsInScope = new Set(taskRows.map((task) => task.id));
  const scopedDependencies = dependencies.filter(
    (dependency) =>
      taskIdsInScope.has(dependency.predecessorTaskId) &&
      taskIdsInScope.has(dependency.successorTaskId),
  );
  return previewScheduleEdit({
    tasks: taskRows,
    projects: projectRows,
    dependencies: scopedDependencies,
    edit: {
      entityType: input.entityType,
      entityId,
      operation: input.operation,
      startDate: input.startDate,
      dueDate: input.dueDate,
    },
  });
}

export async function previewPortfolioScheduleChange(
  input: z.infer<typeof scheduleMoveSchema>,
) {
  await requireUserOrThrow();
  const data = scheduleMoveSchema.parse(input);
  const preview = computeSchedulePreview(data);
  const taskIds = preview.changes
    .filter((change) => change.entityType === "task")
    .map((change) => change.entityId);
  const projectIds = preview.changes
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
  return {
    ...preview,
    changes: preview.changes.map((change) => ({
      ...change,
      title: titleById.get(change.entityId) ?? "",
    })),
  };
}

function canonicalChanges(
  changes: Pick<
    ScheduleEntityChange,
    | "entityType"
    | "entityId"
    | "beforeStartDate"
    | "beforeDueDate"
    | "afterStartDate"
    | "afterDueDate"
  >[],
): string {
  return JSON.stringify(
    changes
      .map((change) => ({
        entityType: change.entityType,
        entityId: change.entityId,
        beforeStartDate: change.beforeStartDate,
        beforeDueDate: change.beforeDueDate,
        afterStartDate: change.afterStartDate,
        afterDueDate: change.afterDueDate,
      }))
      .sort((left, right) =>
        `${left.entityType}:${left.entityId}`.localeCompare(
          `${right.entityType}:${right.entityId}`,
        ),
      ),
  );
}

export async function applyPortfolioScheduleChange(
  input: z.infer<typeof scheduleApplySchema>,
) {
  const user = await requireUserOrThrow();
  const data = scheduleApplySchema.parse(input);
  if (data.operation !== "fit" && !data.expectedPreview) {
    throw new Error("Confirm the current schedule preview before saving");
  }

  const result = db.transaction((tx) => {
    // Read, recompute, compare, and write on the same SQLite transaction
    // snapshot. Row-level before checks below remain a second line of defense.
    const preview = computeSchedulePreview(data, tx);
    const changes = preview.changes;
    if (
      data.expectedPreview &&
      canonicalChanges(data.expectedPreview.changes) !==
        canonicalChanges(changes)
    ) {
      throw new Error("Schedule preview is out of date");
    }
    if (changes.length === 0) {
      return { changeSetId: null, changes, preview };
    }
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
        throw new Error("Schedule changed in another session");
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
        throw new Error("Schedule changed in another session");
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
    return { changeSetId: changeSet.id, changes, preview };
  });
  if (result.changeSetId) revalidatePath("/projects");
  return result;
}

export async function revertPortfolioScheduleChange(changeSetId: string) {
  await requireUserOrThrow();
  db.transaction((tx) => {
    const set = tx
      .select()
      .from(scheduleChangeSets)
      .where(eq(scheduleChangeSets.id, changeSetId))
      .get();
    if (!set || set.status !== "applied") {
      throw new Error("Change cannot be undone");
    }
    const items = tx
      .select()
      .from(scheduleChangeItems)
      .where(eq(scheduleChangeItems.changeSetId, changeSetId))
      .all();
    const projectItems = tx
      .select()
      .from(projectScheduleChangeItems)
      .where(eq(projectScheduleChangeItems.changeSetId, changeSetId))
      .all();
    const currentTasks = tx
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        parentTaskId: tasks.parentTaskId,
        startDate: tasks.startDate,
        dueDate: tasks.dueDate,
        progress: tasks.progress,
        isMilestone: tasks.isMilestone,
        constraintType: tasks.constraintType,
        constraintDate: tasks.constraintDate,
      })
      .from(tasks)
      .all();
    const currentProjects = tx
      .select({
        id: projects.id,
        startDate: projects.plannedStartDate,
        dueDate: projects.targetEndDate,
      })
      .from(projects)
      .all();
    const dependencies = tx.select().from(taskDependencies).all();
    const currentTaskById = new Map(
      currentTasks.map((task) => [task.id, task]),
    );
    const currentProjectById = new Map(
      currentProjects.map((project) => [project.id, project]),
    );

    for (const item of items) {
      const current = currentTaskById.get(item.taskId);
      if (
        !current ||
        current.startDate !== item.afterStartDate ||
        current.dueDate !== item.afterDueDate
      ) {
        throw new Error("A later edit prevents undo");
      }
    }
    for (const item of projectItems) {
      const current = currentProjectById.get(item.projectId);
      if (
        !current ||
        current.startDate !== item.afterStartDate ||
        current.dueDate !== item.afterDueDate
      ) {
        throw new Error("A later edit prevents undo");
      }
    }

    const taskItemById = new Map(items.map((item) => [item.taskId, item]));
    const projectItemById = new Map(
      projectItems.map((item) => [item.projectId, item]),
    );
    const restoredTasks = currentTasks.map((task) => {
      const item = taskItemById.get(task.id);
      return item
        ? {
            ...task,
            startDate: item.beforeStartDate,
            dueDate: item.beforeDueDate,
          }
        : task;
    });
    const restoredProjects = currentProjects.map((project) => {
      const item = projectItemById.get(project.id);
      return item
        ? {
            ...project,
            startDate: item.beforeStartDate,
            dueDate: item.beforeDueDate,
          }
        : project;
    });
    if (hasScheduleCycle(restoredTasks, dependencies)) {
      throw new Error("A later hierarchy edit prevents undo");
    }
    if (
      scheduleContainmentViolations(restoredTasks, restoredProjects).length > 0
    ) {
      throw new Error("Newly nested work prevents undo");
    }
    const currentConflicts = dependencyConflictEdgeKeys(
      currentTasks,
      dependencies,
    );
    const restoredConflicts = dependencyConflictEdgeKeys(
      restoredTasks,
      dependencies,
    );
    if (
      [...restoredConflicts].some((conflict) => !currentConflicts.has(conflict))
    ) {
      throw new Error("A later dependency prevents undo");
    }

    for (const item of items) {
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
