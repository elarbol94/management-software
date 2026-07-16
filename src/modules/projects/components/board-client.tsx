"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  CalendarDays,
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

type Project = typeof projectsTable.$inferSelect;
type ColumnDto = { id: string; name: string; sortOrder: number };

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

function TaskCard({
  task,
  onClick,
  overlay = false,
}: {
  task: BoardTaskDto;
  onClick?: () => void;
  overlay?: boolean;
}) {
  const t = useTranslations("projects");
  const format = useFormatter();
  const overdue =
    task.dueDate !== null && task.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <div
      onClick={onClick}
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
    </div>
  );
}

function SortableTask({
  task,
  onClick,
}: {
  task: BoardTaskDto;
  onClick: () => void;
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
      <TaskCard task={task} onClick={onClick} />
    </div>
  );
}

function BoardColumn({
  column,
  tasks,
  onAddTask,
  onEditTask,
  onRename,
  onDelete,
  canDelete,
}: {
  column: ColumnDto;
  tasks: BoardTaskDto[];
  onAddTask: () => void;
  onEditTask: (task: BoardTaskDto) => void;
  onRename: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const t = useTranslations("projects");
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: { type: "column" },
  });

  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/50 p-2"
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
            <SortableTask key={task.id} task={task} onClick={() => onEditTask(task)} />
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
  members,
}: {
  project: Project;
  columns: ColumnDto[];
  tasksByColumn: Record<string, BoardTaskDto[]>;
  members: MemberDto[];
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const router = useRouter();

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const taskIndex = useMemo(() => {
    const map = new Map<string, BoardTaskDto>();
    for (const list of Object.values(board)) {
      for (const task of list) map.set(task.id, task);
    }
    return map;
  }, [board]);

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

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-2">
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
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => {
            setEditingTask(null);
            setNewTaskColumnId(columns[0]?.id ?? null);
            setTaskDialogOpen(true);
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
        <div className="flex flex-1 items-start gap-3 overflow-x-auto pb-4">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              tasks={board[column.id] ?? []}
              canDelete={columns.length > 1}
              onAddTask={() => {
                setEditingTask(null);
                setNewTaskColumnId(column.id);
                setTaskDialogOpen(true);
              }}
              onEditTask={(task) => {
                setEditingTask(task);
                setTaskDialogOpen(true);
              }}
              onRename={() => onRenameColumn(column)}
              onDelete={() => onDeleteColumn(column)}
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
        onOpenChange={setTaskDialogOpen}
        projectId={project.id}
        columns={columns}
        members={members}
        task={editingTask}
        defaultColumnId={newTaskColumnId}
      />
    </div>
  );
}
