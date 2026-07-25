import {
  sqliteTable,
  text,
  integer,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { user } from "@/db/core-schema";

export const projectStatuses = ["active", "archived"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const taskPriorities = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("#2563eb"),
  status: text("status", { enum: projectStatuses }).notNull().default("active"),
  managerId: text("manager_id").references(() => user.id),
  plannedStartDate: text("planned_start_date"),
  targetEndDate: text("target_end_date"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
}, (table) => [
  index("projects_status_updated_idx").on(table.status, table.updatedAt),
]);

export const projectColumns = sqliteTable(
  "project_columns",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isCompleted: integer("is_completed", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [index("project_columns_project_idx").on(table.projectId)],
);

export const projectPhases = sqliteTable(
  "project_phases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    plannedStartDate: text("planned_start_date"),
    targetEndDate: text("target_end_date"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("project_phases_project_sort_idx").on(table.projectId, table.sortOrder),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    columnId: text("column_id")
      .notNull()
      .references(() => projectColumns.id, { onDelete: "cascade" }),
    phaseId: text("phase_id").references(() => projectPhases.id, {
      onDelete: "set null",
    }),
    parentTaskId: text("parent_task_id").references(
      (): AnySQLiteColumn => tasks.id,
      { onDelete: "cascade" },
    ),
    title: text("title").notNull(),
    // Simple text for now; can hold Tiptap JSON later without a migration.
    description: text("description").notNull().default(""),
    assigneeId: text("assignee_id").references(() => user.id),
    dueDate: text("due_date"), // ISO YYYY-MM-DD
    startDate: text("start_date"), // ISO YYYY-MM-DD
    progress: integer("progress").notNull().default(0),
    isMilestone: integer("is_milestone", { mode: "boolean" })
      .notNull()
      .default(false),
    priority: text("priority", { enum: taskPriorities })
      .notNull()
      .default("medium"),
    // Gap-based ordering within a column (steps of 1000).
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("tasks_project_idx").on(table.projectId),
    index("tasks_column_idx").on(table.columnId),
    index("tasks_assignee_idx").on(table.assigneeId),
    index("tasks_column_sort_idx").on(table.columnId, table.sortOrder),
    index("tasks_assignee_due_idx").on(table.assigneeId, table.dueDate),
    index("tasks_phase_sort_idx").on(table.phaseId, table.sortOrder),
    index("tasks_parent_sort_idx").on(table.parentTaskId, table.sortOrder),
    index("tasks_schedule_idx").on(table.startDate, table.dueDate),
  ],
);

export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    predecessorTaskId: text("predecessor_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    successorTaskId: text("successor_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependencyType: text("dependency_type", {
      enum: ["finish_to_start"],
    })
      .notNull()
      .default("finish_to_start"),
    lagWorkdays: integer("lag_workdays").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("task_dependencies_predecessor_idx").on(table.predecessorTaskId),
    index("task_dependencies_successor_idx").on(table.successorTaskId),
    index("task_dependencies_pair_idx").on(
      table.predecessorTaskId,
      table.successorTaskId,
    ),
  ],
);

export const scheduleChangeSets = sqliteTable(
  "schedule_change_sets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    status: text("status", { enum: ["applied", "reverted"] })
      .notNull()
      .default("applied"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    revertedAt: integer("reverted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("schedule_change_sets_created_by_idx").on(
      table.createdBy,
      table.createdAt,
    ),
  ],
);

export const scheduleChangeItems = sqliteTable(
  "schedule_change_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    changeSetId: text("change_set_id")
      .notNull()
      .references(() => scheduleChangeSets.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    beforeStartDate: text("before_start_date"),
    beforeDueDate: text("before_due_date"),
    afterStartDate: text("after_start_date"),
    afterDueDate: text("after_due_date"),
  },
  (table) => [
    index("schedule_change_items_set_idx").on(table.changeSetId),
    index("schedule_change_items_task_idx").on(table.taskId),
  ],
);

export const projectScheduleChangeItems = sqliteTable(
  "project_schedule_change_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    changeSetId: text("change_set_id")
      .notNull()
      .references(() => scheduleChangeSets.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    beforeStartDate: text("before_start_date"),
    beforeDueDate: text("before_due_date"),
    afterStartDate: text("after_start_date"),
    afterDueDate: text("after_due_date"),
  },
  (table) => [
    index("project_schedule_change_items_set_idx").on(table.changeSetId),
    index("project_schedule_change_items_project_idx").on(table.projectId),
  ],
);
