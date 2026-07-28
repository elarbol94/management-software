"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { toast } from "sonner";
import {
  ArrowLeft,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { moveTask, deleteColumn, upsertColumn } from "@/modules/projects/actions";
import type { projects as projectsTable } from "@/modules/projects/schema";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskDialog, type BoardTaskDto, type MemberDto } from "./task-dialog";
import { cn } from "@/lib/utils";

type Project = typeof projectsTable.$inferSelect;
type ColumnDto = {
  id: string;
  name: string;
  sortOrder: number;
  isCompleted: boolean;
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function descendantLeaves(
  taskId: string,
  subtasksByParent: Record<string, BoardTaskDto[]>,
): BoardTaskDto[] {
  const children = subtasksByParent[taskId] ?? [];
  if (children.length === 0) return [];
  return children.flatMap((child) => {
    const descendants = descendantLeaves(child.id, subtasksByParent);
    return descendants.length > 0 ? descendants : [child];
  });
}

function RecursiveTaskRows({
  parentId,
  depth,
  subtasksByParent,
  columns,
  expandedTasks,
  onToggleTask,
  onAddSubtask,
  onEditTask,
}: {
  parentId: string;
  depth: number;
  subtasksByParent: Record<string, BoardTaskDto[]>;
  columns: ColumnDto[];
  expandedTasks: Set<string>;
  onToggleTask: (taskId: string) => void;
  onAddSubtask: (task: BoardTaskDto) => void;
  onEditTask: (task: BoardTaskDto) => void;
}) {
  const t = useTranslations("projects");
  return (subtasksByParent[parentId] ?? []).map((task) => {
    const children = subtasksByParent[task.id] ?? [];
    const column = columns.find((candidate) => candidate.id === task.columnId);
    const expanded = expandedTasks.has(task.id);
    return (
      <div
        key={task.id}
        data-subtask-id={task.id}
        data-subtask-title={task.title}
        className="border-t border-violet-200/70 dark:border-violet-900"
        style={{ paddingLeft: Math.min(depth, 8) * 14 }}
      >
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          {children.length > 0 ? (
            <button
              type="button"
              className="rounded p-0.5 hover:bg-violet-100 dark:hover:bg-violet-950"
              onClick={(event) => {
                event.stopPropagation();
                onToggleTask(task.id);
              }}
              aria-label={t("toggleSubtasks")}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          ) : (
            <span className={`mx-1 size-1.5 rounded-full ${column?.isCompleted ? "bg-emerald-500" : "bg-violet-400"}`} />
          )}
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-xs hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onEditTask(task);
            }}
          >
            {task.title}
          </button>
          {task.startDate && task.dueDate ? (
            <CalendarDays className="size-3 text-muted-foreground" />
          ) : (
            <AlertTriangle className="size-3 text-amber-600" aria-label={t("unscheduled")} />
          )}
          {!task.isMilestone && (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-violet-100 hover:text-foreground dark:hover:bg-violet-950"
              onClick={(event) => {
                event.stopPropagation();
                onAddSubtask(task);
              }}
              aria-label={t("newSubtask")}
            >
              <Plus className="size-3" />
            </button>
          )}
        </div>
        {children.length > 0 && expanded && (
          <RecursiveTaskRows
            parentId={task.id}
            depth={depth + 1}
            subtasksByParent={subtasksByParent}
            columns={columns}
            expandedTasks={expandedTasks}
            onToggleTask={onToggleTask}
            onAddSubtask={onAddSubtask}
            onEditTask={onEditTask}
          />
        )}
      </div>
    );
  });
}

function TaskCard({
  task,
  subtasksByParent = {},
  columns = [],
  onClick,
  onAddSubtask,
  onEditSubtask,
  expanded = false,
  onToggleExpanded,
  expandedTasks = new Set(),
  onToggleTask,
  overlay = false,
}: {
  task: BoardTaskDto;
  subtasksByParent?: Record<string, BoardTaskDto[]>;
  columns?: ColumnDto[];
  onClick?: () => void;
  onAddSubtask?: (task: BoardTaskDto) => void;
  onEditSubtask?: (task: BoardTaskDto) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  expandedTasks?: Set<string>;
  onToggleTask?: (taskId: string) => void;
  overlay?: boolean;
}) {
  const t = useTranslations("projects");
  const format = useFormatter();
  const overdue =
    task.dueDate !== null && task.dueDate < new Date().toISOString().slice(0, 10);
  const subtasks = subtasksByParent[task.id] ?? [];
  const leaves = descendantLeaves(task.id, subtasksByParent);
  const completedSubtasks = leaves.filter(
    (subtask) =>
      columns.find((column) => column.id === subtask.columnId)?.isCompleted,
  ).length;

  return (
    <div
      onClick={onClick}
      data-task-id={task.id}
      data-task-title={task.title}
      className={`flex cursor-pointer flex-col gap-2 rounded-md border bg-card p-3 text-sm shadow-xs ${
        overlay ? "rotate-2 shadow-lg" : "hover:border-ring/40"
      }`}
    >
      <span className="font-medium">{task.title}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={`${PRIORITY_STYLES[task.priority]} border-transparent`}>
          {t(
            task.priority === "high"
              ? "priorityHigh"
              : task.priority === "low"
                ? "priorityLow"
                : "priorityMedium",
          )}
        </Badge>
        {task.dueDate && (
          <span
            className={`flex items-center gap-1 text-xs ${
              overdue ? "font-medium text-destructive" : "text-muted-foreground"
            }`}
          >
            <CalendarDays className="size-3" />
            {format.dateTime(new Date(task.dueDate), {
              day: "2-digit",
              month: "2-digit",
            })}
          </span>
        )}
        {task.assigneeName && (
          <Avatar className="ml-auto size-5" title={task.assigneeName}>
            <AvatarFallback className="text-[9px]">
              {initials(task.assigneeName)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      {subtasks.length > 0 && (
        <div className="mt-1 rounded-md border border-violet-200/80 bg-violet-50/45 dark:border-violet-900 dark:bg-violet-950/20">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpanded?.();
            }}
            aria-expanded={expanded}
            aria-label={t("toggleSubtasks")}
          >
            {expanded ? (
              <ChevronDown className="size-3.5 text-violet-600" />
            ) : (
              <ChevronRight className="size-3.5 text-violet-600" />
            )}
            <span className="text-xs font-medium">
              {t("subtaskProgress", {
                completed: completedSubtasks,
                total: leaves.length,
              })}
            </span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {task.progress}%
            </span>
          </button>
          <div className="mx-2.5 h-1 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950">
            <div
              className="h-full rounded-full bg-violet-500 transition-[width]"
              style={{ width: `${task.progress}%` }}
            />
          </div>
          {expanded && (
            <div className="mt-2">
              <RecursiveTaskRows
                parentId={task.id}
                depth={0}
                subtasksByParent={subtasksByParent}
                columns={columns}
                expandedTasks={expandedTasks}
                onToggleTask={onToggleTask ?? (() => undefined)}
                onAddSubtask={(child) => onAddSubtask?.(child)}
                onEditTask={(child) => onEditSubtask?.(child)}
              />
            </div>
          )}
        </div>
      )}
      {!overlay && onAddSubtask && (
        <button
          type="button"
          data-add-subtask-for={task.id}
          className="mt-0.5 flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onAddSubtask(task);
          }}
        >
          <Plus className="size-3" />
          {t("newSubtask")}
        </button>
      )}
    </div>
  );
}

function SortableTask({
  task,
  subtasksByParent,
  columns,
  onClick,
  onAddSubtask,
  onEditSubtask,
  expandedTasks,
  onToggleTask,
}: {
  task: BoardTaskDto;
  subtasksByParent: Record<string, BoardTaskDto[]>;
  columns: ColumnDto[];
  onClick: () => void;
  onAddSubtask: (task: BoardTaskDto) => void;
  onEditSubtask: (task: BoardTaskDto) => void;
  expandedTasks: Set<string>;
  onToggleTask: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { type: "task", columnId: task.columnId } });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-40" : undefined}
      {...attributes}
      {...listeners}
    >
      <TaskCard
        task={task}
        subtasksByParent={subtasksByParent}
        columns={columns}
        onClick={onClick}
        onAddSubtask={onAddSubtask}
        onEditSubtask={onEditSubtask}
        expanded={expandedTasks.has(task.id)}
        onToggleExpanded={() => onToggleTask(task.id)}
        expandedTasks={expandedTasks}
        onToggleTask={onToggleTask}
      />
    </div>
  );
}

function BoardColumn({
  column,
  tasks,
  subtasksByParent,
  columns,
  onAddTask,
  onAddSubtask,
  onEditTask,
  onEditSubtask,
  expandedTasks,
  onToggleTask,
  onRename,
  onDelete,
  onToggleCompleted,
  canDelete,
}: {
  column: ColumnDto;
  tasks: BoardTaskDto[];
  subtasksByParent: Record<string, BoardTaskDto[]>;
  columns: ColumnDto[];
  onAddTask: () => void;
  onAddSubtask: (task: BoardTaskDto) => void;
  onEditTask: (task: BoardTaskDto) => void;
  onEditSubtask: (task: BoardTaskDto) => void;
  expandedTasks: Set<string>;
  onToggleTask: (taskId: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onToggleCompleted: () => void;
  canDelete: boolean;
}) {
  const t = useTranslations("projects");
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: { type: "column" },
  });

  return (
    <div
      className="flex min-w-[15rem] flex-1 basis-0 flex-col gap-2 rounded-lg bg-muted/50 p-2"
      data-column-name={column.name}
    >
      <div className="flex items-center gap-2 px-1">
        <span className="text-sm font-medium">{column.name}</span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
        <div className="ml-auto flex items-center">
          <Button variant="ghost" size="icon-xs" onClick={onAddTask} title={t("newTask")}>
            <Plus className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" />}>
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="mr-2 size-4" />
                {t("renameColumn")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleCompleted}>
                <CheckCircle2 className="mr-2 size-4" />
                {column.isCompleted
                  ? t("markColumnIncomplete")
                  : t("markColumnCompleted")}
              </DropdownMenuItem>
              {canDelete && (
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 className="mr-2 size-4" />
                  {t("deleteColumn")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="flex min-h-24 flex-col gap-2">
          {tasks.map((task) => (
            <SortableTask
              key={task.id}
              task={task}
              subtasksByParent={subtasksByParent}
              columns={columns}
              onClick={() => onEditTask(task)}
              onAddSubtask={onAddSubtask}
              onEditSubtask={onEditSubtask}
              expandedTasks={expandedTasks}
              onToggleTask={onToggleTask}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

export function BoardClient({
  project,
  columns,
  tasksByColumn,
  subtasksByParent,
  members,
  predecessorOptions = [],
  hideHeader = false,
}: {
  project: Project;
  columns: ColumnDto[];
  tasksByColumn: Record<string, BoardTaskDto[]>;
  subtasksByParent: Record<string, BoardTaskDto[]>;
  members: MemberDto[];
  predecessorOptions?: Array<{ id: string; title: string; dueDate: string | null; type: "project" | "task" }>;
  hideHeader?: boolean;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Local optimistic copy of the board, refreshed from the server props
  // via render-time state adjustment.
  const [board, setBoard] = useState(tasksByColumn);
  const [prevTasksByColumn, setPrevTasksByColumn] = useState(tasksByColumn);
  if (prevTasksByColumn !== tasksByColumn) {
    setPrevTasksByColumn(tasksByColumn);
    setBoard(tasksByColumn);
  }

  const [activeTask, setActiveTask] = useState<BoardTaskDto | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<BoardTaskDto | null>(null);
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null);
  const [newTaskParentId, setNewTaskParentId] = useState<string | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(
    () => new Set(),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const taskIndex = useMemo(() => {
    const map = new Map<string, BoardTaskDto>();
    for (const list of Object.values(board)) {
      for (const task of list) map.set(task.id, task);
    }
    for (const list of Object.values(subtasksByParent)) {
      for (const task of list) map.set(task.id, task);
    }
    return map;
  }, [board, subtasksByParent]);

  const focusedTaskId = searchParams.get("task");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!focusedTaskId) {
        setTaskDialogOpen(false);
        return;
      }
      const task = taskIndex.get(focusedTaskId);
      if (!task) return;
      setEditingTask(task);
      setNewTaskColumnId(task.columnId);
      setNewTaskParentId(task.parentTaskId);
      setTaskDialogOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusedTaskId, taskIndex]);

  function findColumnOf(taskId: string): string | undefined {
    for (const [columnId, list] of Object.entries(board)) {
      if (list.some((task) => task.id === taskId)) return columnId;
    }
    return undefined;
  }

  function onDragStart(event: DragStartEvent) {
    setActiveTask(taskIndex.get(String(event.active.id)) ?? null);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const fromColumn = findColumnOf(activeId);
    const toColumn =
      over.data.current?.type === "column" ? overId : findColumnOf(overId);
    if (!fromColumn || !toColumn || fromColumn === toColumn) return;

    // Move the task into the target column while dragging (visual preview).
    setBoard((current) => {
      const task = current[fromColumn].find((item) => item.id === activeId);
      if (!task) return current;
      const overIndex =
        over.data.current?.type === "column"
          ? current[toColumn].length
          : current[toColumn].findIndex((item) => item.id === overId);
      const next = { ...current };
      next[fromColumn] = current[fromColumn].filter((item) => item.id !== activeId);
      const target = [...current[toColumn]];
      target.splice(overIndex < 0 ? target.length : overIndex, 0, {
        ...task,
        columnId: toColumn,
      });
      next[toColumn] = target;
      return next;
    });
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const toColumn =
      over.data.current?.type === "column" ? overId : findColumnOf(overId);
    if (!toColumn) return;

    // Compute final position within the target column.
    setBoard((current) => {
      const column = [...(current[toColumn] ?? [])];
      const fromIndex = column.findIndex((item) => item.id === activeId);
      if (fromIndex === -1) return current;
      let toIndex =
        over.data.current?.type === "column"
          ? column.length - 1
          : column.findIndex((item) => item.id === overId);
      if (toIndex < 0) toIndex = column.length - 1;
      const next = { ...current };
      const [moved] = column.splice(fromIndex, 1);
      column.splice(toIndex, 0, moved);
      next[toColumn] = column;

      const afterTaskId = toIndex > 0 ? column[toIndex - 1].id : null;
      moveTask({ taskId: activeId, columnId: toColumn, afterTaskId }).catch(() => {
        toast.error(tCommon("error"));
        router.refresh();
      });
      return next;
    });
  }

  async function onRenameColumn(column: ColumnDto) {
    const name = window.prompt(t("columnName"), column.name);
    if (!name?.trim()) return;
    await upsertColumn({ id: column.id, projectId: project.id, name: name.trim() });
    router.refresh();
  }

  async function onAddColumn() {
    const name = window.prompt(t("columnName"));
    if (!name?.trim()) return;
    await upsertColumn({ projectId: project.id, name: name.trim() });
    router.refresh();
  }

  async function onDeleteColumn(column: ColumnDto) {
    if (!window.confirm(tCommon("confirmDeleteTitle"))) return;
    try {
      await deleteColumn(column.id);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    }
  }

  function openNewTask(columnId: string, parentTaskId: string | null = null) {
    setEditingTask(null);
    setNewTaskColumnId(columnId);
    setNewTaskParentId(parentTaskId);
    setTaskDialogOpen(true);
  }

  function openTask(task: BoardTaskDto) {
    setEditingTask(task);
    setNewTaskColumnId(task.columnId);
    setNewTaskParentId(task.parentTaskId);
    setTaskDialogOpen(true);
    const params = new URLSearchParams(window.location.search);
    params.set("task", task.id);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function setDialogOpen(nextOpen: boolean) {
    setTaskDialogOpen(nextOpen);
    if (nextOpen) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("task");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }

  function toggleTask(taskId: string) {
    setExpandedTasks((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function onToggleCompleted(column: ColumnDto) {
    await upsertColumn({
      id: column.id,
      projectId: project.id,
      name: column.name,
      isCompleted: !column.isCompleted,
    });
    router.refresh();
  }

  return (
    <div className="flex h-full min-w-0 w-full flex-col gap-4">
      <div className={cn("flex min-w-0 w-full items-center gap-2", hideHeader && "justify-end")}>
        {!hideHeader && (
          <>
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/projects" />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <span
          className="inline-block size-3 rounded-full"
          style={{ backgroundColor: project.color }}
        />
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
          </>
        )}
        <Button
          size="sm"
          className={hideHeader ? "" : "ml-auto"}
          onClick={() => {
            openNewTask(columns[0]?.id ?? "");
          }}
        >
          <Plus className="size-4" />
          {t("newTask")}
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex min-w-0 max-w-full flex-1 items-start gap-3 overflow-x-auto pb-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              tasks={board[column.id] ?? []}
              subtasksByParent={subtasksByParent}
              columns={columns}
              expandedTasks={expandedTasks}
              canDelete={columns.length > 1}
              onAddTask={() => openNewTask(column.id)}
              onAddSubtask={(task) => {
                setExpandedTasks((current) => {
                  const next = new Set(current);
                  let cursor: BoardTaskDto | undefined = task;
                  while (cursor) {
                    next.add(cursor.id);
                    cursor = cursor.parentTaskId
                      ? taskIndex.get(cursor.parentTaskId)
                      : undefined;
                  }
                  return next;
                });
                openNewTask(task.columnId, task.id);
              }}
              onEditTask={openTask}
              onEditSubtask={openTask}
              onToggleTask={toggleTask}
              onRename={() => onRenameColumn(column)}
              onDelete={() => onDeleteColumn(column)}
              onToggleCompleted={() => onToggleCompleted(column)}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="mt-1 shrink-0"
            onClick={onAddColumn}
          >
            <Plus className="size-4" />
            {t("newColumn")}
          </Button>
        </div>
        <DragOverlay>
          {activeTask && <TaskCard task={activeTask} overlay />}
        </DragOverlay>
      </DndContext>

      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setDialogOpen}
        projectId={project.id}
        columns={columns}
        members={members}
        task={editingTask}
        defaultColumnId={newTaskColumnId}
        defaultParentTaskId={newTaskParentId}
        parentTask={
          (editingTask?.parentTaskId
            ? taskIndex.get(editingTask.parentTaskId)
            : newTaskParentId
              ? taskIndex.get(newTaskParentId)
              : null) ?? null
        }
        subtasks={editingTask ? (subtasksByParent[editingTask.id] ?? []) : []}
        predecessorOptions={predecessorOptions.filter((candidate) => candidate.id !== editingTask?.id)}
      />
    </div>
  );
}
