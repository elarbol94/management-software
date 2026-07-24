"use server";

import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { projectColumns, projects, tasks } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";

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
        updatedAt: new Date(),
      })
      .where(eq(projects.id, data.id))
      .run();
    revalidatePath("/projects");
    return db.select().from(projects).where(eq(projects.id, data.id)).get()!;
  }

  const row = db
    .insert(projects)
    .values({
      name: data.name,
      description: data.description,
      color: data.color,
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
});

export async function upsertColumn(input: z.infer<typeof columnSchema>) {
  await requireUserOrThrow();
  const data = columnSchema.parse(input);

  if (data.id) {
    db.update(projectColumns)
      .set({ name: data.name })
      .where(eq(projectColumns.id, data.id))
      .run();
  } else {
    const max =
      db
        .select({ value: sql<number>`coalesce(max(${projectColumns.sortOrder}), 0)` })
        .from(projectColumns)
        .where(eq(projectColumns.projectId, data.projectId))
        .get()?.value ?? 0;
    db.insert(projectColumns)
      .values({ projectId: data.projectId, name: data.name, sortOrder: max + SORT_GAP })
      .run();
  }
  revalidatePath(`/projects/${data.projectId}`);
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

  db.update(tasks)
    .set({ columnId: fallback.id })
    .where(eq(tasks.columnId, id))
    .run();
  db.delete(projectColumns).where(eq(projectColumns.id, id)).run();
  revalidatePath(`/projects/${column.projectId}`);
}

// --- Tasks ---

const taskSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().min(1),
  columnId: z.string().min(1),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).default(""),
  assigneeId: z.string().nullable().default(null),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

export type TaskInput = z.infer<typeof taskSchema>;

function nextSortOrder(columnId: string): number {
  const max =
    db
      .select({ value: sql<number>`coalesce(max(${tasks.sortOrder}), 0)` })
      .from(tasks)
      .where(eq(tasks.columnId, columnId))
      .get()?.value ?? 0;
  return max + SORT_GAP;
}

export async function upsertTask(input: TaskInput): Promise<{ id: string }> {
  const user = await requireUserOrThrow();
  const data = taskSchema.parse(input);

  const values = {
    title: data.title,
    description: data.description,
    assigneeId: data.assigneeId,
    dueDate: data.dueDate,
    priority: data.priority,
    updatedAt: new Date(),
  };

  let id = data.id;
  if (id) {
    const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!existing) throw new Error("Task not found");
    const movedColumn = existing.columnId !== data.columnId;
    db.update(tasks)
      .set({
        ...values,
        columnId: data.columnId,
        sortOrder: movedColumn ? nextSortOrder(data.columnId) : existing.sortOrder,
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
        sortOrder: nextSortOrder(data.columnId),
        createdBy: user.id,
      })
      .returning({ id: tasks.id })
      .get();
    id = row.id;
  }

  revalidatePath(`/projects/${data.projectId}`);
  return { id };
}

export async function deleteTask(id: string) {
  await requireUserOrThrow();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return;
  db.delete(tasks).where(eq(tasks.id, id)).run();
  revalidatePath(`/projects/${task.projectId}`);
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

  const columnTasks = db
    .select({ id: tasks.id, sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(and(eq(tasks.columnId, data.columnId), sql`${tasks.id} != ${data.taskId}`))
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
          .set({ sortOrder: (index + 1) * SORT_GAP, columnId: data.columnId })
          .where(eq(tasks.id, t.id))
          .run();
      });
    });
  } else {
    db.update(tasks)
      .set({ columnId: data.columnId, sortOrder })
      .where(eq(tasks.id, data.taskId))
      .run();
  }

  revalidatePath(`/projects/${task.projectId}`);
}
