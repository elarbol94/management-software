"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  Diamond,
  Ellipsis,
  FolderKanban,
  Focus,
  GitBranch,
  IndentDecrease,
  IndentIncrease,
  LocateFixed,
  Minimize2,
  PanelRightClose,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  applyPortfolioScheduleChange,
  deleteTask,
  deleteTaskDependency,
  fitProjectToTasks,
  fitTaskToChildren,
  moveContextualDeadline,
  reparentTask,
  revertPortfolioScheduleChange,
  upsertProject,
  upsertTask,
  upsertTaskDependency,
  type ProjectInput,
  type TaskInput,
} from "@/modules/projects/actions";
import type {
  PortfolioSchedule,
  PortfolioTask,
} from "@/modules/projects/queries";
import {
  containerOverflow,
  criticalPathTaskIds,
  dependencyConflicts,
  dependencyEndpoints,
  dependencyTypeOf,
  hasScheduleCycle,
  assertDependencyEndpoints,
  indentTarget,
  leafTasks,
  outdentTarget,
  suggestTaskPlacement,
  taskAncestors,
  taskDescendants,
  weightedProgress,
  previewScheduleEdit,
  type DependencyType,
  type ScheduleEdit,
  type SchedulePreview,
} from "@/modules/projects/schedule";
import {
  classifyFocusDependencies,
  focusDateRange,
  projectsFocusHref,
  resolveFocusedTaskSubtree,
} from "@/modules/projects/focus";
import {
  routeGanttDependency,
  type GanttRouteObstacle,
  type GanttRoutePoint,
} from "@/modules/projects/gantt-routing";
import { ProjectsClient } from "./projects-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isDeadlineOverdue, localDateValue } from "@/modules/tasks/deadline-utils";

type ProjectCard = PortfolioSchedule["projects"][number] & { openTasks: number };
type Zoom = "week" | "month" | "quarter";
type Row = {
  id: string;
  kind: "project" | "task" | "subtask";
  projectId: string;
  label: string;
  color: string;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  isMilestone: boolean;
  isSummary?: boolean;
  unscheduledCount?: number;
  childTasks?: PortfolioTask[];
  task?: PortfolioTask;
  depth?: number;
  placement?: ReturnType<typeof suggestTaskPlacement>;
  // Set on project rows whose tasks reach outside the authored window (R4).
  overflowStart?: string | null;
  overflowEnd?: string | null;
};
type TaskDraft = {
  taskId: string;
  startDate: string;
  dueDate: string;
  mode: "move" | "resize-start" | "resize-end" | "place";
};
type ProjectDraft = {
  projectId: string;
  startDate: string;
  dueDate: string;
  mode: "move" | "resize-start" | "resize-end" | "place";
};
type DragPreview = {
  preview: SchedulePreview | null;
  draft: TaskDraft | null;
  projectDraft: ProjectDraft | null;
};
type DeadlinePreview = {
  id: string;
  deadlineDate: string;
  deadlineAt: string | null;
  updatedAt: string;
};
type PortfolioDependency = PortfolioSchedule["dependencies"][number];
type DependencyDraft = PortfolioDependency & {
  isNew: boolean;
};
type PortfolioViewState = {
  dayWidth: number;
  scrollLeft: number;
  treeWidth: number;
  expandedProjects: Set<string>;
  expandedTasks: Set<string>;
  selectedTaskId: string | null;
  inspectorOpen: boolean;
};
type StoredPortfolioViewState = {
  focusedTaskId: string;
  view: Omit<PortfolioViewState, "expandedProjects" | "expandedTasks"> & {
    expandedProjects: string[];
    expandedTasks: string[];
  };
};

const LEFT_WIDTH = 352;
const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 54;
const DEADLINE_LANE_HEIGHT = 36;
const FIT_PADDING_DAYS = 7;
const DAY_MS = 86_400_000;
const ZOOM_WIDTH: Record<Zoom, number> = {
  week: 32,
  month: 16,
  quarter: 7,
};
const MIN_DAY_WIDTH = 6;
const MAX_DAY_WIDTH = 44;
const ZOOM_WHEEL_SENSITIVITY = 0.003;
const FOCUS_VIEW_STORAGE_KEY = "projects.focusPortfolioView";
const DEPENDENCY_TYPE_OPTIONS: DependencyType[] = [
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
];

function dependencyTypeTranslationKey(type: DependencyType) {
  switch (type) {
    case "start_to_start":
      return "dependencyTypeStartStart" as const;
    case "finish_to_finish":
      return "dependencyTypeFinishFinish" as const;
    case "start_to_finish":
      return "dependencyTypeStartFinish" as const;
    default:
      return "dependencyTypeFinishStart" as const;
  }
}

function dependencyTypeHintKey(type: DependencyType) {
  switch (type) {
    case "start_to_start":
      return "dependencyTypeStartStartHint" as const;
    case "finish_to_finish":
      return "dependencyTypeFinishFinishHint" as const;
    case "start_to_finish":
      return "dependencyTypeStartFinishHint" as const;
    default:
      return "dependencyTypeFinishStartHint" as const;
  }
}

function dependencyTypeCodeKey(type: DependencyType) {
  switch (type) {
    case "start_to_start":
      return "dependencyTypeStartStartCode" as const;
    case "finish_to_finish":
      return "dependencyTypeFinishFinishCode" as const;
    case "start_to_finish":
      return "dependencyTypeStartFinishCode" as const;
    default:
      return "dependencyTypeFinishStartCode" as const;
  }
}

function dependencyDraftIsInvalid(
  tasks: PortfolioTask[],
  dependencies: PortfolioDependency[],
  draft: DependencyDraft,
) {
  try {
    assertDependencyEndpoints(tasks, draft);
    const candidate = draft.isNew
      ? [...dependencies, draft]
      : dependencies.map((dependency) =>
          dependency.id === draft.id ? draft : dependency,
        );
    return hasScheduleCycle(tasks, candidate);
  } catch {
    return true;
  }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function zoomModeForDayWidth(dayWidth: number): Zoom {
  if (dayWidth >= 24) return "week";
  if (dayWidth >= 11) return "month";
  return "quarter";
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(value: string, days: number) {
  return isoDate(new Date(parseDate(value).getTime() + days * DAY_MS));
}

function calendarDistance(start: string, end: string) {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS);
}

function dependencyPathGeometry({
  dependency,
  predecessor,
  successor,
  predecessorIndex,
  successorIndex,
  rangeStart,
  dayWidth,
  sourceOffsetY = 0,
  targetOffsetY = 0,
  laneOffset = 0,
  obstacles = [],
  occupiedRoutes = [],
}: {
  dependency: PortfolioDependency;
  predecessor: Row;
  successor: Row;
  predecessorIndex: number;
  successorIndex: number;
  rangeStart: string;
  dayWidth: number;
  sourceOffsetY?: number;
  targetOffsetY?: number;
  laneOffset?: number;
  obstacles?: GanttRouteObstacle[];
  occupiedRoutes?: GanttRoutePoint[][];
}) {
  const endpoints = dependencyEndpoints(dependency);
  const predecessorDate =
    endpoints.predecessor === "start"
      ? predecessor.startDate
      : predecessor.dueDate;
  const successorDate =
    endpoints.successor === "start"
      ? successor.startDate
      : successor.dueDate;
  if (!predecessorDate || !successorDate) return null;
  const x1 =
    (calendarDistance(rangeStart, predecessorDate) +
      (endpoints.predecessor === "finish" ? 1 : 0)) *
    dayWidth;
  const x2 =
    (calendarDistance(rangeStart, successorDate) +
      (endpoints.successor === "finish" ? 1 : 0)) *
    dayWidth;
  const y1 =
    predecessorIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + sourceOffsetY;
  const y2 =
    successorIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + targetOffsetY;
  const sourceDirection = endpoints.predecessor === "finish" ? 1 as const : -1 as const;
  const targetDirection = endpoints.successor === "start" ? -1 as const : 1 as const;
  const stub = Math.max(12, Math.min(24, dayWidth));
  const manual =
    dependency.routeOffsetDays !== null ||
    dependency.routeOffsetRows !== null;
  const route = routeGanttDependency({
    source: { x: x1, y: y1 },
    target: { x: x2, y: y2 },
    sourceDirection,
    targetDirection,
    stub,
    obstacles,
    occupiedRoutes,
    excludedObstacleIds: new Set([
      dependency.predecessorTaskId,
      dependency.successorTaskId,
    ]),
    laneBias: laneOffset,
    manualOffset: manual
      ? {
          x: (dependency.routeOffsetDays ?? 0) * dayWidth,
          y: (dependency.routeOffsetRows ?? 0) * (ROW_HEIGHT / 4),
        }
      : null,
  });
  return {
    path: route.path,
    points: route.points,
    labelX: route.handle.x,
    labelY: route.handle.y,
    handles: route.handles,
  };
}

function DependencyRouteHandle({
  axis,
  point,
  dragging,
  label,
  valueText,
  onPointerDown,
  onKeyDown,
}: {
  axis: "x" | "y";
  point: GanttRoutePoint;
  dragging: boolean;
  label: string;
  valueText: string;
  onPointerDown: (
    axis: "x" | "y",
    event: ReactPointerEvent<SVGGElement>,
  ) => void;
  onKeyDown: (
    axis: "x" | "y",
    event: ReactKeyboardEvent<SVGGElement>,
  ) => void;
}) {
  const horizontal = axis === "x";
  return (
    <g
      transform={`translate(${point.x} ${point.y})`}
      role="slider"
      tabIndex={0}
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuetext={valueText}
      className="text-indigo-600 outline-none focus-visible:[filter:drop-shadow(0_0_0.2rem_rgb(79_70_229_/_0.45))]"
      style={{
        pointerEvents: "all",
        cursor: dragging
          ? "grabbing"
          : horizontal
            ? "col-resize"
            : "row-resize",
      }}
      onPointerDown={(event) => onPointerDown(axis, event)}
      onKeyDown={(event) => onKeyDown(axis, event)}
    >
      <rect
        x={horizontal ? -9 : -5}
        y={horizontal ? -5 : -9}
        width={horizontal ? 18 : 10}
        height={horizontal ? 10 : 18}
        rx="5"
        fill="var(--card)"
        stroke="currentColor"
        strokeWidth="1.75"
        className={cn(
          "transition-[filter,transform] duration-150 motion-reduce:transition-none",
          dragging &&
            "[filter:drop-shadow(0_2px_3px_rgb(15_23_42_/_0.24))]",
        )}
      />
      <path
        d={
          horizontal
            ? "M -4 0 H 4 M -4 0 L -2 -2 M -4 0 L -2 2 M 4 0 L 2 -2 M 4 0 L 2 2"
            : "M 0 -4 V 4 M 0 -4 L -2 -2 M 0 -4 L 2 -2 M 0 4 L -2 2 M 0 4 L 2 2"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
    </g>
  );
}

function calendarWeek(date: Date) {
  const weekDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = weekDate.getUTCDay() || 7;
  weekDate.setUTCDate(weekDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(weekDate.getUTCFullYear(), 0, 1));
  return Math.ceil(((weekDate.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

function minDate(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
}

function maxDate(values: Array<string | null | undefined>) {
  const sorted = values.filter((value): value is string => Boolean(value)).sort();
  return sorted.at(-1) ?? null;
}

function DependencyEditorPanel({
  draft,
  tasks,
  pending,
  invalid = false,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: DependencyDraft;
  tasks: PortfolioTask[];
  pending: boolean;
  invalid?: boolean;
  onChange: (draft: DependencyDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const predecessor = tasks.find(
    (task) => task.id === draft.predecessorTaskId,
  );
  const successor = tasks.find(
    (task) => task.id === draft.successorTaskId,
  );

  return (
    <div className="grid gap-3" data-testid="dependency-editor">
      <div className="rounded-md border-l-2 border-l-indigo-500 bg-muted/35 px-3 py-2">
        <p className="truncate text-xs font-medium">{predecessor?.title}</p>
        <div className="my-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.08em] text-indigo-600 dark:text-indigo-400">
          <span>{t(dependencyTypeCodeKey(draft.dependencyType))}</span>
          <ArrowRight className="size-3" aria-hidden />
        </div>
        <p className="truncate text-xs font-medium">{successor?.title}</p>
      </div>

      <div className="grid gap-1.5">
        <Label>{t("dependencyType")}</Label>
        <div
          className="grid grid-cols-2 gap-1.5"
          role="radiogroup"
          aria-label={t("dependencyType")}
        >
          {DEPENDENCY_TYPE_OPTIONS.map((type, index) => {
            const selected = draft.dependencyType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn(
                  "group/type rounded-md border px-2.5 py-2 text-left transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none",
                  selected
                    ? "border-indigo-500 bg-indigo-50 shadow-[inset_0_0_0_1px_color-mix(in_oklab,#4f46e5_24%,transparent)] dark:bg-indigo-950/35"
                    : "border-border bg-card hover:border-indigo-300 hover:bg-muted/45",
                )}
                onClick={() =>
                  onChange({ ...draft, dependencyType: type })
                }
                onKeyDown={(event) => {
                  if (
                    event.key !== "ArrowLeft" &&
                    event.key !== "ArrowRight" &&
                    event.key !== "ArrowUp" &&
                    event.key !== "ArrowDown"
                  ) {
                    return;
                  }
                  event.preventDefault();
                  const delta =
                    event.key === "ArrowRight" || event.key === "ArrowDown"
                      ? 1
                      : -1;
                  const nextIndex =
                    (index + delta + DEPENDENCY_TYPE_OPTIONS.length) %
                    DEPENDENCY_TYPE_OPTIONS.length;
                  onChange({
                    ...draft,
                    dependencyType: DEPENDENCY_TYPE_OPTIONS[nextIndex],
                  });
                  const buttons =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role="radio"]',
                    );
                  buttons?.[nextIndex]?.focus();
                }}
              >
                <span className="block font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
                  {t(dependencyTypeCodeKey(type))}
                </span>
                <span className="mt-0.5 block text-xs font-medium">
                  {t(dependencyTypeTranslationKey(type))}
                </span>
                <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">
                  {t(dependencyTypeHintKey(type))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`dependency-lag-${draft.id}`}>{t("lagDays")}</Label>
        <Input
          id={`dependency-lag-${draft.id}`}
          type="number"
          min={-365}
          max={365}
          value={draft.lagDays}
          onChange={(event) =>
            onChange({
              ...draft,
              lagDays: Math.min(
                365,
                Math.max(-365, Number(event.target.value) || 0),
              ),
            })
          }
        />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {t("dependencyLagHint")}
        </p>
        {invalid && (
          <p className="text-xs font-medium text-destructive" role="alert">
            {t("dependencyInvalid")}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/25 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">
            {draft.routeOffsetDays === null && draft.routeOffsetRows === null
              ? t("dependencyRouteAutomatic")
              : t("dependencyRouteManual")}
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {t("dependencyRouteHint")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={
            pending ||
            (draft.routeOffsetDays === null && draft.routeOffsetRows === null)
          }
          onClick={() =>
            onChange({
              ...draft,
              routeOffsetDays: null,
              routeOffsetRows: null,
            })
          }
        >
          <LocateFixed className="size-3.5" />
          {t("dependencyRouteReset")}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        {!draft.isNew && onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
            {tCommon("delete")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={onCancel}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || invalid}
            onClick={onSave}
          >
            {draft.isNew ? t("createDependency") : tCommon("save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function storePortfolioView(focusedTaskId: string, view: PortfolioViewState) {
  try {
    const stored: StoredPortfolioViewState = {
      focusedTaskId,
      view: {
        ...view,
        expandedProjects: [...view.expandedProjects],
        expandedTasks: [...view.expandedTasks],
      },
    };
    window.sessionStorage.setItem(
      FOCUS_VIEW_STORAGE_KEY,
      JSON.stringify(stored),
    );
  } catch {
    // Focus remains functional when browser storage is unavailable.
  }
}

function readStoredPortfolioView(
  focusedTaskId: string,
): PortfolioViewState | null {
  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(FOCUS_VIEW_STORAGE_KEY) ?? "null",
    ) as StoredPortfolioViewState | null;
    if (!stored || stored.focusedTaskId !== focusedTaskId) return null;
    return {
      ...stored.view,
      expandedProjects: new Set(stored.view.expandedProjects),
      expandedTasks: new Set(stored.view.expandedTasks),
    };
  } catch {
    return null;
  }
}

function clearStoredPortfolioView() {
  try {
    window.sessionStorage.removeItem(FOCUS_VIEW_STORAGE_KEY);
  } catch {
    // Nothing to clear when browser storage is unavailable.
  }
}

function projectRisk(
  project: PortfolioSchedule["projects"][number],
  tasks: PortfolioTask[],
  today: string,
) {
  const leaves = leafTasks(tasks);
  const unfinished = leaves.filter((task) => task.progress < 100);
  const overdue = unfinished.some((task) => task.dueDate && task.dueDate < today);
  const projectedEnd = maxDate(leaves.map((task) => task.dueDate));
  return overdue || Boolean(project.targetEndDate && projectedEnd && projectedEnd > project.targetEndDate);
}

function ScheduleInspector({
  open,
  onOpenChange,
  presentation,
  dockWidth,
  onDockResizePointerDown,
  onDockResizeKeyDown,
  schedule,
  task,
  defaultProjectId,
  defaultParentTaskId,
  onAddSubtask,
  onOpenTask,
  onFocusTask,
  isTaskFocused,
  onTaskSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentation: "dock" | "sheet-right" | "sheet-bottom";
  dockWidth?: number;
  onDockResizePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDockResizeKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  schedule: PortfolioSchedule;
  task: PortfolioTask | null;
  defaultProjectId: string | null;
  defaultParentTaskId: string | null;
  onAddSubtask: (task: PortfolioTask) => void;
  onOpenTask: (task: PortfolioTask) => void;
  onFocusTask: (task: PortfolioTask) => void;
  isTaskFocused: boolean;
  onTaskSaved: (taskId: string, parentTaskId: string | null) => void;
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const projectId = task?.projectId ?? defaultProjectId ?? "";
  const parentTaskId = task?.parentTaskId ?? defaultParentTaskId ?? null;
  const parentTask = parentTaskId
    ? schedule.tasks.find((candidate) => candidate.id === parentTaskId) ?? null
    : null;
  const childTasks = task
    ? schedule.tasks.filter((candidate) => candidate.parentTaskId === task.id)
    : [];
  const descendantTasks = task ? taskDescendants(schedule.tasks, task.id) : [];
  const breadcrumbs = task
    ? [...taskAncestors(schedule.tasks, task.id)].reverse()
    : parentTask
      ? [...taskAncestors(schedule.tasks, parentTask.id)].reverse().concat(parentTask)
      : [];
  const isSummary = childTasks.length > 0;
  const projectColumns = schedule.columns.filter((column) => column.projectId === projectId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnId, setColumnId] = useState("");
  const [assigneeId, setAssigneeId] = useState("unassigned");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [progress, setProgress] = useState(0);
  const [isMilestone, setIsMilestone] = useState(false);
  const [constraintType, setConstraintType] = useState<
    "asap" | "start_no_earlier_than" | "must_start_on"
  >("asap");
  const [constraintDate, setConstraintDate] = useState("");
  const [predecessorId, setPredecessorId] = useState("none");
  const [dependencyType, setDependencyType] =
    useState<DependencyType>("finish_to_start");
  const [lagDays, setLagDays] = useState(0);
  const [dependencyEditorDraft, setDependencyEditorDraft] =
    useState<DependencyDraft | null>(null);
  const [dependencyPending, setDependencyPending] = useState(false);
  const [pending, setPending] = useState(false);

  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open
    ? `${task?.id ?? "new"}-${task?.updatedAt?.getTime() ?? ""}-${defaultProjectId ?? ""}-${defaultParentTaskId ?? ""}`
    : null;
  if (syncKey !== currentKey) {
    setSyncKey(currentKey);
    if (currentKey !== null) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setColumnId(task?.columnId ?? projectColumns[0]?.id ?? "");
      setAssigneeId(task?.assigneeId ?? "unassigned");
      setPriority(task?.priority ?? "medium");
      setStartDate(task?.startDate ?? "");
      setDueDate(task?.dueDate ?? "");
      setProgress(task?.progress ?? 0);
      setIsMilestone(task?.isMilestone ?? false);
      setConstraintType(task?.constraintType ?? "asap");
      setConstraintDate(task?.constraintDate ?? "");
      setPredecessorId("none");
      setDependencyType("finish_to_start");
      setLagDays(0);
      setDependencyEditorDraft(null);
    }
  }

  const incoming = task
    ? schedule.dependencies.filter((dependency) => dependency.successorTaskId === task.id)
    : [];
  // Summaries can anchor links now (R6); only the task's own branch is excluded,
  // because a summary already spans its subtree.
  const linkableTasks = useMemo(() => {
    if (!task) return [];
    const excluded = new Set([
      task.id,
      ...taskAncestors(schedule.tasks, task.id).map((ancestor) => ancestor.id),
      ...taskDescendants(schedule.tasks, task.id).map((descendant) => descendant.id),
    ]);
    return schedule.tasks.filter((candidate) => !excluded.has(candidate.id));
  }, [schedule.tasks, task]);

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId || !columnId) return;
    setPending(true);
    try {
      const input: TaskInput = {
        id: task?.id,
        projectId,
        parentTaskId,
        columnId,
        title,
        description,
        assigneeId: assigneeId === "unassigned" ? null : assigneeId,
        priority,
        startDate: startDate || null,
        dueDate: isMilestone ? startDate || null : dueDate || null,
        progress,
        isMilestone,
        constraintType,
        constraintDate: constraintType === "asap" ? null : constraintDate || null,
      };
      const saved = await upsertTask(input);
      onTaskSaved(saved.id, parentTaskId);
      toast.success(tCommon("saved"));
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  async function addDependency() {
    if (!task || predecessorId === "none") return;
    try {
      await upsertTaskDependency({
        predecessorTaskId: predecessorId,
        successorTaskId: task.id,
        dependencyType,
        lagDays,
        routeOffsetDays: null,
        routeOffsetRows: null,
      });
      setPredecessorId("none");
      setDependencyType("finish_to_start");
      setLagDays(0);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error && error.message.includes("cycle") ? t("dependencyCycle") : tCommon("error"));
    }
  }

  async function saveDependencyDraft() {
    if (!dependencyEditorDraft) return;
    if (
      dependencyDraftIsInvalid(
        schedule.tasks,
        schedule.dependencies,
        dependencyEditorDraft,
      )
    ) {
      toast.error(t("dependencyInvalid"));
      return;
    }
    setDependencyPending(true);
    try {
      await upsertTaskDependency({
        id: dependencyEditorDraft.isNew
          ? undefined
          : dependencyEditorDraft.id,
        predecessorTaskId: dependencyEditorDraft.predecessorTaskId,
        successorTaskId: dependencyEditorDraft.successorTaskId,
        dependencyType: dependencyEditorDraft.dependencyType,
        lagDays: dependencyEditorDraft.lagDays,
        routeOffsetDays: dependencyEditorDraft.routeOffsetDays,
        routeOffsetRows: dependencyEditorDraft.routeOffsetRows,
      });
      setDependencyEditorDraft(null);
      router.refresh();
      toast.success(t("dependencySaved"));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.includes("cycle")
          ? t("dependencyCycle")
          : t("dependencySaveError"),
      );
    } finally {
      setDependencyPending(false);
    }
  }

  async function deleteDependencyDraft() {
    if (!dependencyEditorDraft || dependencyEditorDraft.isNew) return;
    setDependencyPending(true);
    try {
      await deleteTaskDependency(dependencyEditorDraft.id);
      setDependencyEditorDraft(null);
      router.refresh();
      toast.success(t("dependencyDeleted"));
    } catch {
      toast.error(t("dependencySaveError"));
    } finally {
      setDependencyPending(false);
    }
  }

  const inspectorContent = (
    <>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium text-foreground">
            {task ? t("editTask") : parentTaskId ? t("newSubtask") : t("newTask")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("scheduleInspectorDescription")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {task && (
            <Button
              type="button"
              variant={isTaskFocused ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={() => onFocusTask(task)}
              aria-label={isTaskFocused ? t("focusedTask") : t("focusTask")}
              title={isTaskFocused ? t("focusedTask") : t("focusTask")}
            >
              <Focus className="size-4" />
            </Button>
          )}
          {presentation === "dock" && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              aria-label={t("closeInspector")}
            >
              <PanelRightClose className="size-4" />
            </Button>
          )}
        </div>
      </div>
        <form onSubmit={saveTask} className="flex flex-col gap-5 px-4 pb-6">
          {parentTask && (
            <div className="rounded-md border-l-2 border-l-violet-500 bg-muted/45 px-3 py-2 text-sm">
              <span className="text-xs text-muted-foreground">{t("subtaskOf")}</span>
              <span className="ml-2 font-medium">
                {breadcrumbs.map((item) => item.title).join(" / ")}
              </span>
            </div>
          )}
          {isSummary && (
            <div className="rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
              {t("summaryScheduleDescription")}
              {leafTasks(descendantTasks).some((child) => !child.startDate || !child.dueDate) && (
                <span className="mt-1 block font-medium text-amber-700 dark:text-amber-400">
                  {t("unscheduledSubtasks", {
                    count: leafTasks(descendantTasks).filter((child) => !child.startDate || !child.dueDate).length,
                  })}
                </span>
              )}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="schedule-task-title">{t("taskTitle")}</Label>
            <Input id="schedule-task-title" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={300} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="schedule-task-description">{t("description")}</Label>
            <Textarea id="schedule-task-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={5000} />
          </div>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>{t("column")}</Label>
              <Select value={columnId} onValueChange={(value) => setColumnId(value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {projectColumns.find((column) => column.id === columnId)?.name ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projectColumns.map((column) => <SelectItem key={column.id} value={column.id}>{column.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t("assignee")}</Label>
              <Select value={assigneeId} onValueChange={(value) => setAssigneeId(value ?? "unassigned")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {assigneeId === "unassigned"
                      ? t("unassigned")
                      : schedule.members.find((member) => member.id === assigneeId)?.name ??
                        t("unassigned")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">{t("unassigned")}</SelectItem>
                  {schedule.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("priority")}</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {priority === "low"
                      ? t("priorityLow")
                      : priority === "high"
                        ? t("priorityHigh")
                        : t("priorityMedium")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("priorityLow")}</SelectItem>
                  <SelectItem value="medium">{t("priorityMedium")}</SelectItem>
                  <SelectItem value="high">{t("priorityHigh")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="schedule-milestone" checked={isMilestone} onCheckedChange={(checked) => setIsMilestone(Boolean(checked))} disabled={isSummary} />
            <Label htmlFor="schedule-milestone">{t("milestone")}</Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="schedule-start">{isMilestone ? t("milestoneDate") : t("startDate")}</Label>
              <Input id="schedule-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </div>
            {!isMilestone && (
              <div className="grid gap-2">
                <Label htmlFor="schedule-due">{t("dueDate")}</Label>
                <Input id="schedule-due" type="date" value={dueDate} min={startDate || undefined} onChange={(event) => setDueDate(event.target.value)} />
              </div>
            )}
          </div>
          {!isSummary && (
            <div className="grid gap-3 rounded-md border bg-muted/25 p-3">
              <div className="grid gap-2">
                <Label>{t("constraintType")}</Label>
                <Select value={constraintType} onValueChange={(value) => setConstraintType((value ?? "asap") as typeof constraintType)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {constraintType === "asap"
                        ? t("constraintAsap")
                        : constraintType === "start_no_earlier_than"
                          ? t("constraintNoEarlierThan")
                          : t("constraintMustStartOn")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asap">{t("constraintAsap")}</SelectItem>
                    <SelectItem value="start_no_earlier_than">{t("constraintNoEarlierThan")}</SelectItem>
                    <SelectItem value="must_start_on">{t("constraintMustStartOn")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {constraintType !== "asap" && (
                <div className="grid gap-2">
                  <Label htmlFor="schedule-constraint-date">{t("constraintDate")}</Label>
                  <Input
                    id="schedule-constraint-date"
                    type="date"
                    value={constraintDate}
                    onChange={(event) => setConstraintDate(event.target.value)}
                    required={constraintType === "must_start_on"}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {constraintType === "asap"
                  ? t("constraintAsapHint")
                  : constraintType === "start_no_earlier_than"
                    ? t("constraintNoEarlierThanHint")
                    : t("constraintMustStartOnHint")}
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="schedule-progress">{t("progress")}</Label>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{progress}%</span>
            </div>
            <Input id="schedule-progress" type="range" min={0} max={100} step={5} value={progress} onChange={(event) => setProgress(Number(event.target.value))} disabled={isSummary} />
          </div>
          {task && !task.isMilestone && (
            <div className="grid gap-3 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{t("subtasks")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("subtaskProgress", {
                      completed: childTasks.filter((child) => child.progress === 100).length,
                      total: childTasks.length,
                    })}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => onAddSubtask(task)}>
                  <Plus className="size-3.5" />{t("newSubtask")}
                </Button>
              </div>
              {childTasks.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{t("noSubtasks")}</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {childTasks.map((child) => (
                    <button key={child.id} type="button" onClick={() => onOpenTask(child)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50">
                      {child.isMilestone ? <Diamond className="size-3.5 fill-violet-500 text-violet-600" /> : <CircleDot className="size-3.5 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate">{child.title}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{child.progress}%</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {task && (
            <div className="grid gap-3 border-t pt-4">
              <div>
                <h3 className="text-sm font-medium">{t("dependencies")}</h3>
                <p className="text-xs text-muted-foreground">{t("dependenciesDescription")}</p>
              </div>
              {incoming.map((dependency) => {
                const predecessor = schedule.tasks.find((candidate) => candidate.id === dependency.predecessorTaskId);
                return (
                  <div key={dependency.id} className="flex items-center gap-1 rounded-md border p-1 text-sm">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted/55 focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() =>
                        setDependencyEditorDraft({
                          ...dependency,
                          dependencyType: dependencyTypeOf(dependency),
                          isNew: false,
                        })
                      }
                    >
                      <GitBranch className="size-4 shrink-0 text-indigo-500" />
                      <span className="min-w-0 flex-1 truncate">{predecessor?.title}</span>
                      <span className="rounded-sm bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                        {t(dependencyTypeCodeKey(dependencyTypeOf(dependency)))}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">{dependency.lagDays >= 0 ? "+" : ""}{dependency.lagDays}d</span>
                    </button>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={tCommon("delete")} onClick={async () => {
                      await deleteTaskDependency(dependency.id);
                      router.refresh();
                    }}><Trash2 className="size-3.5" /></Button>
                  </div>
                );
              })}
              <div className="grid gap-2 rounded-md border border-dashed p-2">
                <Select value={predecessorId} onValueChange={(value) => setPredecessorId(value ?? "none")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {predecessorId === "none"
                        ? t("choosePredecessor")
                        : linkableTasks.find((candidate) => candidate.id === predecessorId)?.title ??
                          t("choosePredecessor")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("choosePredecessor")}</SelectItem>
                    {linkableTasks.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>{candidate.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-[1fr_5.5rem_auto] gap-2">
                  <Select value={dependencyType} onValueChange={(value) => setDependencyType((value ?? "finish_to_start") as DependencyType)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {t(dependencyTypeTranslationKey(dependencyType))}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {DEPENDENCY_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(dependencyTypeTranslationKey(type))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="number" min={-365} max={365} value={lagDays} onChange={(event) => setLagDays(Number(event.target.value))} aria-label={t("lagDays")} />
                  <Button type="button" variant="outline" size="icon" onClick={addDependency} disabled={predecessorId === "none"} aria-label={t("addDependency")}><Plus className="size-4" /></Button>
                </div>
              </div>
              <Dialog
                open={Boolean(dependencyEditorDraft)}
                onOpenChange={(nextOpen) => {
                  if (!nextOpen && !dependencyPending) {
                    setDependencyEditorDraft(null);
                  }
                }}
              >
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t("editDependency")}</DialogTitle>
                  </DialogHeader>
                  {dependencyEditorDraft && (
                    <DependencyEditorPanel
                      draft={dependencyEditorDraft}
                      tasks={schedule.tasks}
                      pending={dependencyPending}
                      invalid={dependencyDraftIsInvalid(
                        schedule.tasks,
                        schedule.dependencies,
                        dependencyEditorDraft,
                      )}
                      onChange={setDependencyEditorDraft}
                      onSave={() => void saveDependencyDraft()}
                      onCancel={() => setDependencyEditorDraft(null)}
                      onDelete={() => void deleteDependencyDraft()}
                    />
                  )}
                </DialogContent>
              </Dialog>
            </div>
          )}
          <Button type="submit" disabled={pending || !title.trim() || !columnId}>
            {tCommon("save")}
          </Button>
        </form>
    </>
  );

  if (!open) return null;

  if (presentation === "dock") {
    return (
      <aside
        className="relative hidden h-full shrink-0 overflow-y-auto border-l bg-card min-[960px]:block"
        style={{ width: dockWidth }}
        aria-label={t("taskDetails")}
        data-testid="schedule-inspector-dock"
      >
        <div
          role="separator"
          aria-label={t("resizeInspector")}
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={520}
          aria-valuenow={dockWidth}
          tabIndex={0}
          className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize bg-transparent transition-colors motion-reduce:transition-none hover:bg-violet-400/45 focus-visible:bg-violet-500"
          onPointerDown={onDockResizePointerDown}
          onKeyDown={onDockResizeKeyDown}
        />
        {inspectorContent}
      </aside>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={presentation === "sheet-bottom" ? "bottom" : "right"}
        className={cn(
          "overflow-y-auto",
          presentation === "sheet-bottom"
            ? "max-h-[88dvh] rounded-t-xl"
            : "w-[min(34rem,96vw)] sm:max-w-lg",
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{task ? t("editTask") : parentTaskId ? t("newSubtask") : t("newTask")}</SheetTitle>
          <SheetDescription>{t("scheduleInspectorDescription")}</SheetDescription>
        </SheetHeader>
        {inspectorContent}
      </SheetContent>
    </Sheet>
  );
}

function NewProjectDialog({
  open,
  onOpenChange,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: PortfolioSchedule["members"];
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [managerId, setManagerId] = useState("none");
  const [plannedStartDate, setPlannedStartDate] = useState("");
  const [targetEndDate, setTargetEndDate] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const input: ProjectInput = {
        name,
        description,
        color,
        managerId: managerId === "none" ? null : managerId,
        plannedStartDate: plannedStartDate || null,
        targetEndDate: targetEndDate || null,
      };
      await upsertProject(
        input,
        [t("colOpen"), t("colInProgress"), t("colDone")],
      );
      onOpenChange(false);
      setName("");
      setDescription("");
      toast.success(tCommon("saved"));
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{t("newProject")}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="portfolio-project-name">{t("name")}</Label><Input id="portfolio-project-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
          <div className="grid gap-2"><Label htmlFor="portfolio-project-description">{t("description")}</Label><Textarea id="portfolio-project-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></div>
          <div className="grid grid-cols-[5rem_1fr] gap-3">
            <div className="grid gap-2"><Label htmlFor="portfolio-project-color">{t("color")}</Label><input id="portfolio-project-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-9 w-full cursor-pointer rounded-md border bg-background p-1" /></div>
            <div className="grid gap-2"><Label>{t("manager")}</Label><Select value={managerId} onValueChange={(value) => setManagerId(value ?? "none")}><SelectTrigger className="w-full"><SelectValue>{managerId === "none" ? t("unassigned") : members.find((member) => member.id === managerId)?.name ?? t("unassigned")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="none">{t("unassigned")}</SelectItem>{members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2"><Label htmlFor="portfolio-project-start">{t("plannedStart")}</Label><Input id="portfolio-project-start" type="date" value={plannedStartDate} onChange={(event) => setPlannedStartDate(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="portfolio-project-target">{t("targetEnd")}</Label><Input id="portfolio-project-target" type="date" value={targetEndDate} min={plannedStartDate || undefined} onChange={(event) => setTargetEndDate(event.target.value)} /></div>
          </div>
          <Button type="submit" disabled={pending}>{tCommon("save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PortfolioClient({
  schedule,
  projects,
  initialFocusedTaskId = null,
}: {
  schedule: PortfolioSchedule;
  projects: ProjectCard[];
  initialFocusedTaskId?: string | null;
}) {
  const t = useTranslations("projects");
  const tDeadlines = useTranslations("deadlines");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const desktopInspector = useMediaQuery("(min-width: 960px)");
  const compactInspector = useMediaQuery("(max-width: 767px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [renderedAt] = useState(() => new Date());
  const today = new Date().toISOString().slice(0, 10);
  const [view, setView] = useState<"timeline" | "projects">("timeline");
  const [zoom, setZoom] = useState<Zoom>("month");
  const [dayWidth, setDayWidth] = useState(ZOOM_WIDTH.month);
  const [treeWidth, setTreeWidth] = useState(LEFT_WIDTH);
  const [ganttViewportWidth, setGanttViewportWidth] = useState(0);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [health, setHealth] = useState<"all" | "risk" | "track">("all");
  const [criticalVisible, setCriticalVisible] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState(() => new Set(schedule.projects.map((project) => project.id)));
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(() => new Set());
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(Boolean(initialFocusedTaskId));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    initialFocusedTaskId,
  );
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(
    initialFocusedTaskId,
  );
  const [inspectorWidth, setInspectorWidth] = useState(360);
  const [newTaskContext, setNewTaskContext] = useState<{
    projectId: string;
    parentTaskId: string | null;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [scheduleCommitPending, setScheduleCommitPending] = useState(false);
  const [deadlinePreview, setDeadlinePreview] = useState<DeadlinePreview | null>(null);
  const [deadlineCommitPending, setDeadlineCommitPending] = useState(false);
  const [dependencySourceId, setDependencySourceId] = useState<string | null>(null);
  const [dependencyHoverId, setDependencyHoverId] = useState<string | null>(null);
  const [hoveredDependencyId, setHoveredDependencyId] = useState<string | null>(
    null,
  );
  const [dependencyDraft, setDependencyDraft] =
    useState<DependencyDraft | null>(null);
  const [dependencyEditorOpen, setDependencyEditorOpen] = useState(false);
  const [dependencyCommitPending, setDependencyCommitPending] = useState(false);
  const [dependencyRouteDragging, setDependencyRouteDragging] = useState<
    "x" | "y" | null
  >(null);
  const draft = dragPreview?.draft ?? null;
  const projectDraft = dragPreview?.projectDraft ?? null;
  const activePreview = dragPreview?.preview ?? null;
  const [undoChangeSetId, setUndoChangeSetId] = useState<string | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    task: PortfolioTask;
    descendantCount: number;
  } | null>(null);
  const [revealTaskId, setRevealTaskId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayWidthRef = useRef(ZOOM_WIDTH.month);
  const dragRef = useRef<{
    pointerId: number;
    mode: "move" | "start" | "end" | "place";
    task: PortfolioTask;
    startX: number;
    timelineLeft: number;
    latest: { taskId: string; startDate: string; dueDate: string };
  } | null>(null);
  const projectDragRef = useRef<{
    pointerId: number;
    mode: "move" | "start" | "end" | "place";
    project: PortfolioSchedule["projects"][number];
    startX: number;
    original: { startDate: string; dueDate: string };
    latest: { startDate: string; dueDate: string };
  } | null>(null);
  const treeResizeRef = useRef<{ pointerId: number; startX: number; width: number } | null>(null);
  const inspectorResizeRef = useRef<{
    pointerId: number;
    startX: number;
    width: number;
  } | null>(null);
  const deadlineDragRef = useRef<{
    pointerId: number;
    deadline: PortfolioSchedule["deadlines"][number];
    startX: number;
    latestDate: string;
  } | null>(null);
  const deadlinePreviewFrameRef = useRef<number | null>(null);
  const pendingDeadlinePreviewRef = useRef<DeadlinePreview | null>(null);
  const connectorGestureRef = useRef<{
    pointerId: number;
    task: PortfolioTask;
    startX: number;
    timelineLeft: number;
    activatedResize: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const dependencyRouteDragRef = useRef<{
    pointerId: number;
    axis: "x" | "y";
    dependency: DependencyDraft;
    startX: number;
    startY: number;
    baseDays: number;
    baseRows: number;
    latestDays: number;
    latestRows: number;
    frame: number | null;
  } | null>(null);
  const portfolioViewRef = useRef<PortfolioViewState | null>(null);
  const fittedPortfolioRef = useRef(false);
  const fittedFocusRef = useRef<string | null>(null);
  const routeFocusedTaskRef = useRef<string | null>(initialFocusedTaskId);
  // A bar is both draggable and clickable, and the browser fires click after
  // pointerup either way. Once the pointer has travelled past the threshold the
  // gesture was a drag, so the click that follows must not open the inspector.
  const draggedRef = useRef(false);
  const previewFrameRef = useRef<number | null>(null);
  const pendingPreviewRef = useRef<{
    edit: ScheduleEdit;
    draft: TaskDraft | null;
    projectDraft: ProjectDraft | null;
  } | null>(null);
  const confirmedScheduleRef = useRef(schedule);

  useEffect(() => {
    if (confirmedScheduleRef.current === schedule) return;
    confirmedScheduleRef.current = schedule;
    pendingPreviewRef.current = null;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    setDragPreview(null);
    setDeadlinePreview(null);
    setDependencyDraft(null);
    setDependencyEditorOpen(false);
  }, [schedule]);

  useEffect(
    () => () => {
      if (previewFrameRef.current !== null) {
        cancelAnimationFrame(previewFrameRef.current);
      }
      if (deadlinePreviewFrameRef.current !== null) {
        cancelAnimationFrame(deadlinePreviewFrameRef.current);
      }
      if (connectorGestureRef.current) {
        clearTimeout(connectorGestureRef.current.timer);
      }
    },
    [],
  );

  useEffect(() => {
    if (view !== "timeline") return;
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    const updateViewportWidth = () => {
      setGanttViewportWidth(scrollContainer.clientWidth);
    };
    updateViewportWidth();
    const observer = new ResizeObserver(updateViewportWidth);
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [view, focusedTaskId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const previousFocusedTaskId = routeFocusedTaskRef.current;
      routeFocusedTaskRef.current = initialFocusedTaskId;
      setFocusedTaskId(initialFocusedTaskId);
      if (initialFocusedTaskId) {
        if (!portfolioViewRef.current) {
          portfolioViewRef.current = readStoredPortfolioView(initialFocusedTaskId);
        }
        if (portfolioViewRef.current) {
          storePortfolioView(initialFocusedTaskId, portfolioViewRef.current);
        }
        setSelectedTaskId(initialFocusedTaskId);
        setInspectorOpen(true);
      }
      if (previousFocusedTaskId && !initialFocusedTaskId && portfolioViewRef.current) {
        fittedFocusRef.current = null;
        const savedView = portfolioViewRef.current;
        const restoredDayWidth = Math.min(
          MAX_DAY_WIDTH,
          Math.max(MIN_DAY_WIDTH, savedView.dayWidth),
        );
        dayWidthRef.current = restoredDayWidth;
        setDayWidth(restoredDayWidth);
        setZoom(zoomModeForDayWidth(restoredDayWidth));
        setTreeWidth(savedView.treeWidth);
        setExpandedProjects(savedView.expandedProjects);
        setExpandedTasks(savedView.expandedTasks);
        setSelectedTaskId(savedView.selectedTaskId);
        setInspectorOpen(savedView.inspectorOpen);
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({
            left: savedView.scrollLeft,
            behavior: "auto",
          });
        });
        clearStoredPortfolioView();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFocusedTaskId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const saved = Number(window.localStorage.getItem("projects.inspectorWidth"));
      if (Number.isFinite(saved) && saved >= 320 && saved <= 520) {
        setInspectorWidth(saved);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function moveInspectorResize(event: PointerEvent) {
      const resize = inspectorResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      setInspectorWidth(
        Math.min(520, Math.max(320, resize.width + resize.startX - event.clientX)),
      );
    }
    function finishInspectorResize(event: PointerEvent) {
      const resize = inspectorResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      inspectorResizeRef.current = null;
      setInspectorWidth((width) => {
        window.localStorage.setItem("projects.inspectorWidth", String(width));
        return width;
      });
    }
    window.addEventListener("pointermove", moveInspectorResize);
    window.addEventListener("pointerup", finishInspectorResize);
    window.addEventListener("pointercancel", finishInspectorResize);
    return () => {
      window.removeEventListener("pointermove", moveInspectorResize);
      window.removeEventListener("pointerup", finishInspectorResize);
      window.removeEventListener("pointercancel", finishInspectorResize);
    };
  }, []);

  const effectiveDependencies = useMemo(
    () =>
      dependencyDraft
        ? dependencyDraft.isNew ||
          !schedule.dependencies.some(
            (dependency) => dependency.id === dependencyDraft.id,
          )
          ? [...schedule.dependencies, dependencyDraft]
          : schedule.dependencies.map((dependency) =>
              dependency.id === dependencyDraft.id
                ? dependencyDraft
                : dependency,
            )
        : schedule.dependencies,
    [dependencyDraft, schedule.dependencies],
  );

  const dependencySchedulePreview = useMemo<SchedulePreview | null>(() => {
    if (!dependencyDraft) return null;
    const successor = schedule.tasks.find(
      (task) => task.id === dependencyDraft.successorTaskId,
    );
    if (!successor?.startDate || !successor.dueDate) return null;
    try {
      return previewScheduleEdit({
        tasks: schedule.tasks,
        projects: schedule.projects.map((project) => ({
          id: project.id,
          startDate: project.plannedStartDate,
          dueDate: project.targetEndDate,
        })),
        dependencies: effectiveDependencies,
        edit: {
          entityType: "task",
          entityId: successor.id,
          operation: "move",
          startDate: successor.startDate,
          dueDate: successor.dueDate,
        },
      });
    } catch {
      return null;
    }
  }, [
    dependencyDraft,
    effectiveDependencies,
    schedule.projects,
    schedule.tasks,
  ]);

  const effectiveSchedule = useMemo<PortfolioSchedule>(() => {
    const schedulePreview = dependencyDraft
      ? dependencySchedulePreview
      : activePreview;
    if (!schedulePreview && !deadlinePreview && !dependencyDraft) {
      return schedule;
    }
    const taskChanges = new Map(
      (schedulePreview?.changes ?? [])
        .filter((change) => change.entityType === "task")
        .map((change) => [change.entityId, change]),
    );
    const projectChanges = new Map(
      (schedulePreview?.changes ?? [])
        .filter((change) => change.entityType === "project")
        .map((change) => [change.entityId, change]),
    );
    return {
      ...schedule,
      tasks: schedule.tasks.map((task) => {
        const change = taskChanges.get(task.id);
        return change
          ? {
              ...task,
              startDate: change.afterStartDate,
              dueDate: change.afterDueDate,
            }
          : task;
      }),
      projects: schedule.projects.map((project) => {
        const change = projectChanges.get(project.id);
        return change
          ? {
              ...project,
              plannedStartDate: change.afterStartDate,
              targetEndDate: change.afterDueDate,
            }
          : project;
      }),
      deadlines: schedule.deadlines.map((deadline) =>
        deadlinePreview?.id === deadline.id
          ? {
              ...deadline,
              dueDate: deadlinePreview.deadlineDate,
              deadlineAt: deadlinePreview.deadlineAt,
              updatedAt: deadlinePreview.updatedAt,
            }
          : deadline,
      ),
      dependencies: effectiveDependencies,
    };
  }, [
    activePreview,
    deadlinePreview,
    dependencyDraft,
    dependencySchedulePreview,
    effectiveDependencies,
    schedule,
  ]);

  const selectedTask =
    effectiveSchedule.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const focusedTask =
    effectiveSchedule.tasks.find((task) => task.id === focusedTaskId) ?? null;
  const focusedProject = focusedTask
    ? effectiveSchedule.projects.find((project) => project.id === focusedTask.projectId) ?? null
    : null;
  const focusedSubtree = useMemo(
    () =>
      focusedTask
        ? resolveFocusedTaskSubtree(effectiveSchedule.tasks, focusedTask.id)
        : null,
    [focusedTask, effectiveSchedule.tasks],
  );
  const focusedTaskIds = useMemo(
    () => new Set(focusedSubtree?.taskIds ?? []),
    [focusedSubtree],
  );
  const focusDependencies = useMemo(
    () =>
      classifyFocusDependencies(effectiveSchedule.dependencies, focusedTaskIds),
    [effectiveSchedule.dependencies, focusedTaskIds],
  );
  const visibleFocusDependencyIds = useMemo(() => {
    if (!focusedTask) return null;
    if (criticalVisible || !selectedTask || !focusedTaskIds.has(selectedTask.id)) {
      return new Set(focusDependencies.internal.map((dependency) => dependency.id));
    }
    const branchIds = new Set([
      selectedTask.id,
      ...taskAncestors(effectiveSchedule.tasks, selectedTask.id).map((task) => task.id),
      ...taskDescendants(effectiveSchedule.tasks, selectedTask.id).map((task) => task.id),
    ]);
    return new Set(
      focusDependencies.internal
        .filter(
          (dependency) =>
            branchIds.has(dependency.predecessorTaskId) &&
            branchIds.has(dependency.successorTaskId),
        )
        .map((dependency) => dependency.id),
    );
  }, [
    focusedTask,
    focusedTaskIds,
    focusDependencies.internal,
    selectedTask,
    effectiveSchedule.tasks,
    criticalVisible,
  ]);

  // Summaries take part in dependencies now (R6), so conflicts and the critical
  // path are computed over the whole tree rather than just its leaves.
  const conflicts = useMemo(
    () => dependencyConflicts(effectiveSchedule.tasks, effectiveSchedule.dependencies),
    [effectiveSchedule],
  );
  const critical = useMemo(
    () =>
      criticalVisible
        ? criticalPathTaskIds(effectiveSchedule.tasks, effectiveSchedule.dependencies)
        : new Set<string>(),
    [effectiveSchedule, criticalVisible],
  );
  const dragImpact = useMemo(() => {
    if (!draft && !projectDraft) return null;
    const impact = activePreview?.impact;
    return {
      days: impact?.dayDelta ?? 0,
      taskCount: impact?.affectedTaskCount ?? 0,
      containerCount:
        (impact?.expandedTaskCount ?? 0) +
        (impact?.expandedProjectCount ?? 0),
      constrained: Boolean(
        activePreview?.constraints.some(
          (constraint) => constraint.clampedStart || constraint.clampedEnd,
        ),
      ),
    };
  }, [draft, projectDraft, activePreview]);
  const tasksByProject = useMemo(() => {
    const map = new Map<string, PortfolioTask[]>();
    for (const task of effectiveSchedule.tasks) {
      const list = map.get(task.projectId) ?? [];
      list.push(task);
      map.set(task.projectId, list);
    }
    return map;
  }, [effectiveSchedule.tasks]);

  const visibleProjects = useMemo(() => {
    if (focusedTask) {
      return effectiveSchedule.projects.filter((project) => project.id === focusedTask.projectId);
    }
    return effectiveSchedule.projects.filter((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const matchesOwner =
        owner === "all" ||
        project.managerId === owner ||
        projectTasks.some((task) => task.assigneeId === owner);
      const risk = projectRisk(project, projectTasks, today);
      const matchesHealth = health === "all" || (health === "risk" ? risk : !risk);
      return matchesOwner && matchesHealth;
    });
  }, [effectiveSchedule.projects, tasksByProject, owner, health, today, focusedTask]);

  const searchResults = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return { projects: [], tasks: [] };
    return {
      projects: effectiveSchedule.projects
        .filter((project) => project.name.toLocaleLowerCase().includes(needle))
        .slice(0, 5),
      tasks: effectiveSchedule.tasks
        .filter((task) => task.title.toLocaleLowerCase().includes(needle))
        .slice(0, 8),
    };
  }, [query, effectiveSchedule.projects, effectiveSchedule.tasks]);

  const portfolioRows = useMemo(() => {
    const result: Row[] = [];
    for (const project of visibleProjects) {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const projectLeaves = leafTasks(projectTasks);
      // A project bar shows the window that was authored for it, not the span of
      // its work — so work reaching past it is drawn as overflow instead (R3/R4).
      const projectStart = project.plannedStartDate;
      const projectDue = project.targetEndDate;
      const overflow = containerOverflow(
        { startDate: projectStart, dueDate: projectDue },
        projectTasks,
      );
      result.push({
        id: `project-${project.id}`,
        kind: "project",
        projectId: project.id,
        label: project.name,
        color: project.color,
        progress: weightedProgress(projectLeaves),
        startDate: projectStart ?? overflow.startDate,
        dueDate: projectDue ?? overflow.dueDate,
        isMilestone: false,
        overflowStart: overflow.clampedStart ? overflow.startDate : null,
        overflowEnd: overflow.clampedEnd ? overflow.dueDate : null,
        placement: suggestTaskPlacement({
          today,
          siblings: [],
          days: 20,
        }),
      });
      if (!expandedProjects.has(project.id)) continue;
      const appendTask = (
        task: PortfolioTask,
        depth: number,
      ) => {
        const childTasks = projectTasks.filter(
          (candidate) => candidate.parentTaskId === task.id,
        );
        const renderDraftTask = (candidate: PortfolioTask) => candidate;
        const descendantTasks = taskDescendants(projectTasks, task.id).map(renderDraftTask);
        const isSummary = childTasks.length > 0;
        const renderedTask = renderDraftTask(task);
        const siblings = projectTasks.filter(
          (candidate) => candidate.parentTaskId === task.parentTaskId && candidate.id !== task.id,
        );
        const parent = task.parentTaskId
          ? projectTasks.find((candidate) => candidate.id === task.parentTaskId)
          : {
              startDate: project.plannedStartDate,
              dueDate: project.targetEndDate,
            };
        result.push({
          id: task.id,
          kind: depth === 0 ? "task" : "subtask",
          projectId: project.id,
          label: task.title,
          color: project.color,
          progress: task.progress,
          startDate: renderedTask.startDate,
          dueDate: renderedTask.dueDate,
          isMilestone: task.isMilestone,
          isSummary,
          unscheduledCount: leafTasks(descendantTasks).filter(
            (child) => !child.startDate || !child.dueDate,
          ).length,
          childTasks: descendantTasks,
          task,
          depth,
          placement: suggestTaskPlacement({
            today,
            parent,
            siblings,
            days: task.isMilestone ? 1 : 5,
          }),
        });
        if (isSummary && expandedTasks.has(task.id)) {
          for (const child of childTasks) {
            appendTask(child, depth + 1);
          }
        }
      };
      for (const task of projectTasks.filter(
        (candidate) => !candidate.parentTaskId,
      )) {
        appendTask(task, 0);
      }
    }
    return result;
  }, [visibleProjects, tasksByProject, expandedProjects, expandedTasks, today]);

  const rows = useMemo(() => {
    if (!focusedSubtree) return portfolioRows;
    return portfolioRows
      .filter((row) => Boolean(row.task && focusedTaskIds.has(row.task.id)))
      .map((row) => ({
        ...row,
        kind: (row.task?.id === focusedSubtree.root.id ? "task" : "subtask") as Row["kind"],
        depth: focusedSubtree.depthByTaskId[row.task!.id] ?? 0,
      }));
  }, [portfolioRows, focusedSubtree, focusedTaskIds]);

  useEffect(() => {
    if (!focusedSubtree) return;
    const frame = requestAnimationFrame(() => {
      setExpandedProjects((current) => new Set(current).add(focusedSubtree.root.projectId));
      setExpandedTasks((current) => {
        const next = new Set(current);
        for (const task of focusedSubtree.tasks) {
          if (schedule.tasks.some((candidate) => candidate.parentTaskId === task.id)) {
            next.add(task.id);
          }
        }
        for (const ancestor of focusedSubtree.ancestors) next.add(ancestor.id);
        return next;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedSubtree, schedule.tasks]);

  const range = useMemo(() => {
    if (focusedTaskId) {
      const confirmedFocus = resolveFocusedTaskSubtree(
        schedule.tasks,
        focusedTaskId,
      );
      const focusRange = focusDateRange(confirmedFocus?.tasks ?? [], today, {
        paddingDays: FIT_PADDING_DAYS,
        fallbackDays: 20,
      });
      return {
        start: focusRange.startDate,
        end: focusRange.dueDate,
      };
    }
    const visibleProjectIds = new Set(
      visibleProjects.map((project) => project.id),
    );
    const scheduled = [
      ...schedule.projects
        .filter((project) => visibleProjectIds.has(project.id))
        .flatMap((project) => [
          project.plannedStartDate,
          project.targetEndDate,
        ]),
      ...schedule.tasks
        .filter((task) => visibleProjectIds.has(task.projectId))
        .flatMap((task) => [task.startDate, task.dueDate]),
      ...schedule.deadlines.map((deadline) => deadline.dueDate),
    ].filter((value): value is string => Boolean(value));
    const earliest = minDate(scheduled) ?? today;
    const latest = maxDate(scheduled) ?? today;
    return {
      start: addCalendarDays(earliest, -FIT_PADDING_DAYS),
      end: addCalendarDays(latest, FIT_PADDING_DAYS),
    };
  }, [
    focusedTaskId,
    schedule.tasks,
    schedule.projects,
    schedule.deadlines,
    visibleProjects,
    today,
  ]);
  const baseDayCount = calendarDistance(range.start, range.end) + 1;
  const viewportDayCount = Math.max(
    0,
    Math.ceil(
      Math.max(0, ganttViewportWidth - treeWidth) / Math.max(dayWidth, 1),
    ),
  );
  const dayCount = Math.max(baseDayCount, viewportDayCount);
  const renderedRangeEnd = addCalendarDays(range.start, dayCount - 1);
  const timelineWidth = dayCount * dayWidth;
  const totalWidth = treeWidth + timelineWidth;
  const deadlineLaneHeight =
    !focusedTask && effectiveSchedule.deadlines.length > 0
      ? DEADLINE_LANE_HEIGHT
      : 0;
  const totalHeight = HEADER_HEIGHT + deadlineLaneHeight + rows.length * ROW_HEIGHT;

  useEffect(() => {
    if (focusedTaskId) {
      if (fittedFocusRef.current === focusedTaskId) return;
      fittedFocusRef.current = focusedTaskId;
    } else {
      if (fittedPortfolioRef.current) return;
      fittedPortfolioRef.current = true;
    }
    const frame = requestAnimationFrame(() => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) return;
      const availableTimelineWidth = Math.max(
        240,
        scrollContainer.clientWidth - treeWidth - 12,
      );
      const fittedDayWidth = Math.min(
        MAX_DAY_WIDTH,
        Math.max(
          MIN_DAY_WIDTH,
          availableTimelineWidth / Math.max(1, baseDayCount),
        ),
      );
      dayWidthRef.current = fittedDayWidth;
      setDayWidth(fittedDayWidth);
      setZoom(zoomModeForDayWidth(fittedDayWidth));
      requestAnimationFrame(() => {
        scrollContainer.scrollTo({
          left: 0,
          behavior: reducedMotion ? "auto" : "smooth",
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedTaskId, baseDayCount, treeWidth, reducedMotion]);

  useEffect(() => {
    if (!revealTaskId) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(
      `[data-task-id="${revealTaskId}"]`,
    );
    if (!row) return;
    row.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });
    setRevealTaskId(null);
  }, [revealTaskId, rows, reducedMotion]);

  const nextMilestone = schedule.tasks
    .filter((task) => task.isMilestone && task.dueDate && task.dueDate >= today && task.progress < 100)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
  const riskCount = schedule.projects.filter((project) =>
    projectRisk(project, tasksByProject.get(project.id) ?? [], today),
  ).length;
  const focusBreadcrumbs = focusedSubtree && focusedProject
    ? [
        { id: focusedProject.id, label: focusedProject.name },
        ...focusedSubtree.ancestors.map((task) => ({ id: task.id, label: task.title })),
        { id: focusedSubtree.root.id, label: focusedSubtree.root.title },
      ]
    : [];
  const incomingExternalTasks = focusDependencies.incomingExternal
    .map((dependency) =>
      schedule.tasks.find(
        (task) => task.id === dependency.predecessorTaskId,
      ),
    )
    .filter((task): task is PortfolioTask => Boolean(task));
  const outgoingExternalTasks = focusDependencies.outgoingExternal
    .map((dependency) =>
      schedule.tasks.find((task) => task.id === dependency.successorTaskId),
    )
    .filter((task): task is PortfolioTask => Boolean(task));

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTask(task: PortfolioTask) {
    setSelectedTaskId(task.id);
    setNewTaskContext(null);
    setInspectorOpen(true);
  }

  function revealProject(projectId: string) {
    setExpandedProjects((current) => new Set(current).add(projectId));
    setOwner("all");
    setHealth("all");
    setQuery("");
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-project-id="${projectId}"]`)
        ?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "center",
          inline: "nearest",
        });
    });
  }

  function enterTaskFocus(task: PortfolioTask) {
    if (!focusedTaskId) {
      portfolioViewRef.current = {
        dayWidth: dayWidthRef.current,
        scrollLeft: scrollRef.current?.scrollLeft ?? 0,
        treeWidth,
        expandedProjects: new Set(expandedProjects),
        expandedTasks: new Set(expandedTasks),
        selectedTaskId,
        inspectorOpen,
      };
    }
    if (portfolioViewRef.current) {
      storePortfolioView(task.id, portfolioViewRef.current);
    }
    setSelectedTaskId(task.id);
    setFocusedTaskId(task.id);
    setInspectorOpen(true);
    fittedFocusRef.current = null;
    const subtree = resolveFocusedTaskSubtree(schedule.tasks, task.id);
    if (subtree) {
      setExpandedProjects((current) => new Set(current).add(task.projectId));
      setExpandedTasks((current) => {
        const next = new Set(current);
        for (const candidate of [...subtree.ancestors, ...subtree.tasks]) {
          if (schedule.tasks.some((child) => child.parentTaskId === candidate.id)) {
            next.add(candidate.id);
          }
        }
        return next;
      });
    }
    if (focusedTaskId) {
      router.replace(projectsFocusHref(task.id), { scroll: false });
    } else {
      router.push(projectsFocusHref(task.id), { scroll: false });
    }
  }

  function exitTaskFocus() {
    const savedView = portfolioViewRef.current;
    setFocusedTaskId(null);
    fittedFocusRef.current = null;
    if (savedView) {
      setTimelineDayWidth(savedView.dayWidth);
      setTreeWidth(savedView.treeWidth);
      setExpandedProjects(savedView.expandedProjects);
      setExpandedTasks(savedView.expandedTasks);
      setSelectedTaskId(savedView.selectedTaskId);
      setInspectorOpen(savedView.inspectorOpen);
      clearStoredPortfolioView();
      router.back();
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          left: savedView.scrollLeft,
          behavior: "auto",
        });
      });
    } else {
      router.replace(projectsFocusHref(null), { scroll: false });
    }
  }

  async function copyFocusLink() {
    if (!focusedTaskId) return;
    try {
      await navigator.clipboard.writeText(
        new URL(projectsFocusHref(focusedTaskId), window.location.origin).toString(),
      );
      toast.success(t("focusLinkCopied"));
    } catch {
      toast.error(tCommon("error"));
    }
  }

  function newTask(
    projectId: string,
    parentTaskId: string | null = null,
  ) {
    if (parentTaskId) {
      const ancestors = taskAncestors(schedule.tasks, parentTaskId);
      setExpandedTasks((current) => {
        const next = new Set(current);
        next.add(parentTaskId);
        ancestors.forEach((ancestor) => next.add(ancestor.id));
        return next;
      });
    }
    setSelectedTaskId(null);
    setNewTaskContext({ projectId, parentTaskId });
    setInspectorOpen(true);
  }

  function localSchedulePreview(edit: ScheduleEdit) {
    return previewScheduleEdit({
      tasks: schedule.tasks,
      projects: schedule.projects.map((project) => ({
        id: project.id,
        startDate: project.plannedStartDate,
        dueDate: project.targetEndDate,
      })),
      dependencies: schedule.dependencies,
      edit,
    });
  }

  function atomicPreview(
    input: ScheduleEdit,
    taskDraft: TaskDraft | null,
    nextProjectDraft: ProjectDraft | null,
  ): DragPreview {
    try {
      const preview = localSchedulePreview(input);
      return { preview, draft: taskDraft, projectDraft: nextProjectDraft };
    } catch {
      return { preview: null, draft: taskDraft, projectDraft: nextProjectDraft };
    }
  }

  function previewCascade(
    input: ScheduleEdit,
    taskDraft: TaskDraft | null = null,
    nextProjectDraft: ProjectDraft | null = null,
  ) {
    setDragPreview(atomicPreview(input, taskDraft, nextProjectDraft));
  }

  function queuePreview(
    input: ScheduleEdit,
    taskDraft: TaskDraft | null,
    nextProjectDraft: ProjectDraft | null,
  ) {
    pendingPreviewRef.current = {
      edit: input,
      draft: taskDraft,
      projectDraft: nextProjectDraft,
    };
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null;
      const pending = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
      if (!pending) return;
      setDragPreview(
        atomicPreview(pending.edit, pending.draft, pending.projectDraft),
      );
    });
  }

  const DRAG_CLICK_THRESHOLD = 4;

  /** Marks the gesture a drag once the pointer travels far enough to count. */
  function trackDragMovement(clientX: number, startX: number) {
    if (Math.abs(clientX - startX) > DRAG_CLICK_THRESHOLD) draggedRef.current = true;
  }

  function validDependencyTarget(targetId: string) {
    const sourceId = dependencySourceId;
    if (!sourceId || sourceId === targetId) return false;
    if (
      effectiveSchedule.dependencies.some(
        (dependency) =>
          dependency.predecessorTaskId === sourceId &&
          dependency.successorTaskId === targetId,
      )
    ) {
      return false;
    }
    try {
      assertDependencyEndpoints(effectiveSchedule.tasks, {
        predecessorTaskId: sourceId,
        successorTaskId: targetId,
      });
      return !hasScheduleCycle(effectiveSchedule.tasks, [
        ...effectiveSchedule.dependencies,
        {
          predecessorTaskId: sourceId,
          successorTaskId: targetId,
          dependencyType: "finish_to_start",
          lagDays: 0,
        },
      ]);
    } catch {
      return false;
    }
  }

  function createGraphicalDependency(targetId: string) {
    const sourceId = dependencySourceId;
    if (!sourceId || !validDependencyTarget(targetId)) return;
    const nextDraft: DependencyDraft = {
      id: `draft-${sourceId}-${targetId}`,
      predecessorTaskId: sourceId,
      successorTaskId: targetId,
      dependencyType: "finish_to_start",
      lagDays: 0,
      routeOffsetDays: null,
      routeOffsetRows: null,
      createdAt: new Date(),
      isNew: true,
    };
    setDependencyDraft(nextDraft);
    setDependencyEditorOpen(true);
    setDependencySourceId(null);
    setDependencyHoverId(null);
  }

  function openDependencyEditor(dependency: PortfolioDependency) {
    setDependencyDraft({
      ...dependency,
      dependencyType: dependencyTypeOf(dependency),
      isNew: dependency.id.startsWith("draft-"),
    });
    setDependencyEditorOpen(true);
    setHoveredDependencyId(null);
  }

  function selectDependency(dependency: PortfolioDependency) {
    if (
      dependencyDraft?.id === dependency.id &&
      !dependencyEditorOpen
    ) {
      setDependencyEditorOpen(true);
      return;
    }
    setDependencyDraft({
      ...dependency,
      dependencyType: dependencyTypeOf(dependency),
      isNew: dependency.id.startsWith("draft-"),
    });
    setDependencyEditorOpen(false);
    setHoveredDependencyId(null);
  }

  function cancelDependencyEditor() {
    if (dependencyCommitPending || dependencyRouteDragging) return;
    setDependencyDraft(null);
    setDependencyEditorOpen(false);
  }

  async function persistDependencyRoute(
    dependency: DependencyDraft,
    routeOffsetDays: number,
    routeOffsetRows: number,
  ) {
    if (dependencyCommitPending || dependency.isNew) return;
    setDependencyCommitPending(true);
    try {
      const persisted = await upsertTaskDependency({
        id: dependency.id,
        predecessorTaskId: dependency.predecessorTaskId,
        successorTaskId: dependency.successorTaskId,
        dependencyType: dependency.dependencyType,
        lagDays: dependency.lagDays,
        routeOffsetDays,
        routeOffsetRows,
      });
      setDependencyDraft({
        ...persisted,
        dependencyType: dependencyTypeOf(persisted),
        isNew: false,
      });
      router.refresh();
      toast.success(t("dependencyRouteSaved"));
    } catch {
      setDependencyDraft(dependency);
      toast.error(t("dependencyRouteSaveError"));
    } finally {
      setDependencyCommitPending(false);
    }
  }

  function beginDependencyRouteDrag(
    axis: "x" | "y",
    event: ReactPointerEvent<SVGGElement>,
  ) {
    if (
      !dependencyDraft ||
      dependencyDraft.isNew ||
      dependencyCommitPending
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dependencyRouteDragRef.current = {
      pointerId: event.pointerId,
      axis,
      dependency: dependencyDraft,
      startX: event.clientX,
      startY: event.clientY,
      baseDays: dependencyDraft.routeOffsetDays ?? 0,
      baseRows: dependencyDraft.routeOffsetRows ?? 0,
      latestDays: dependencyDraft.routeOffsetDays ?? 0,
      latestRows: dependencyDraft.routeOffsetRows ?? 0,
      frame: null,
    };
    setDependencyRouteDragging(axis);
  }

  function nudgeDependencyRoute(
    axis: "x" | "y",
    event: ReactKeyboardEvent<SVGGElement>,
  ) {
    if (
      !dependencyDraft ||
      dependencyDraft.isNew ||
      dependencyCommitPending
    ) {
      return;
    }
    const negative =
      axis === "x" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const positive =
      axis === "x" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!negative && !positive) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? (axis === "x" ? 7 : 4) : 1;
    const delta = negative ? -step : step;
    const nextDays =
      axis === "x"
        ? Math.max(
            -3650,
            Math.min(3650, (dependencyDraft.routeOffsetDays ?? 0) + delta),
          )
        : dependencyDraft.routeOffsetDays ?? 0;
    const nextRows =
      axis === "y"
        ? Math.max(
            -400,
            Math.min(400, (dependencyDraft.routeOffsetRows ?? 0) + delta),
          )
        : dependencyDraft.routeOffsetRows ?? 0;
    setDependencyDraft({
      ...dependencyDraft,
      routeOffsetDays: nextDays,
      routeOffsetRows: nextRows,
    });
    void persistDependencyRoute(dependencyDraft, nextDays, nextRows);
  }

  function updateDependencyRouteDrag(
    pointerId: number,
    clientX: number,
    clientY: number,
  ) {
    const drag = dependencyRouteDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    if (drag.axis === "x") {
      drag.latestDays = Math.max(
        -3650,
        Math.min(
          3650,
          drag.baseDays +
            Math.round((clientX - drag.startX) / dayWidthRef.current),
        ),
      );
    } else {
      drag.latestRows = Math.max(
        -400,
        Math.min(
          400,
          drag.baseRows +
            Math.round((clientY - drag.startY) / (ROW_HEIGHT / 4)),
        ),
      );
    }
    if (drag.frame !== null) return;
    drag.frame = requestAnimationFrame(() => {
      const latest = dependencyRouteDragRef.current;
      if (!latest) return;
      latest.frame = null;
      setDependencyDraft((current) =>
        current?.id === latest.dependency.id
          ? {
              ...current,
              routeOffsetDays: latest.latestDays,
              routeOffsetRows: latest.latestRows,
            }
          : current,
      );
    });
  }

  function completeDependencyRouteDrag(
    pointerId: number,
    cancelled = false,
  ) {
    const drag = dependencyRouteDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    dependencyRouteDragRef.current = null;
    setDependencyRouteDragging(null);
    if (cancelled) {
      setDependencyDraft(drag.dependency);
      return;
    }
    setDependencyDraft((current) =>
      current?.id === drag.dependency.id
        ? {
            ...current,
            routeOffsetDays: drag.latestDays,
            routeOffsetRows: drag.latestRows,
          }
        : current,
    );
    void persistDependencyRoute(
      drag.dependency,
      drag.latestDays,
      drag.latestRows,
    );
  }

  useEffect(() => {
    function moveDependencyRouteGlobally(event: PointerEvent) {
      if (!dependencyRouteDragRef.current) return;
      updateDependencyRouteDrag(
        event.pointerId,
        event.clientX,
        event.clientY,
      );
    }
    function finishDependencyRouteGlobally(event: PointerEvent) {
      if (!dependencyRouteDragRef.current) return;
      completeDependencyRouteDrag(
        event.pointerId,
        event.type === "pointercancel",
      );
    }
    window.addEventListener("pointermove", moveDependencyRouteGlobally);
    window.addEventListener("pointerup", finishDependencyRouteGlobally);
    window.addEventListener("pointercancel", finishDependencyRouteGlobally);
    return () => {
      window.removeEventListener("pointermove", moveDependencyRouteGlobally);
      window.removeEventListener("pointerup", finishDependencyRouteGlobally);
      window.removeEventListener(
        "pointercancel",
        finishDependencyRouteGlobally,
      );
    };
  });

  async function saveGraphicalDependency() {
    if (!dependencyDraft || dependencyCommitPending) return;
    if (
      dependencyDraftIsInvalid(
        schedule.tasks,
        schedule.dependencies,
        dependencyDraft,
      )
    ) {
      toast.error(t("dependencyInvalid"));
      return;
    }
    setDependencyCommitPending(true);
    try {
      const persisted = await upsertTaskDependency({
        id: dependencyDraft.isNew ? undefined : dependencyDraft.id,
        predecessorTaskId: dependencyDraft.predecessorTaskId,
        successorTaskId: dependencyDraft.successorTaskId,
        dependencyType: dependencyDraft.dependencyType,
        lagDays: dependencyDraft.lagDays,
        routeOffsetDays: dependencyDraft.routeOffsetDays,
        routeOffsetRows: dependencyDraft.routeOffsetRows,
      });
      setDependencyDraft({
        ...persisted,
        dependencyType: dependencyTypeOf(persisted),
        isNew: false,
      });
      setDependencyEditorOpen(false);
      router.refresh();
      toast.success(t("dependencySaved"));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.includes("cycle")
          ? t("dependencyCycle")
          : t("dependencySaveError"),
      );
    } finally {
      setDependencyCommitPending(false);
    }
  }

  async function deleteGraphicalDependency() {
    if (
      !dependencyDraft ||
      dependencyDraft.isNew ||
      dependencyCommitPending
    ) {
      return;
    }
    setDependencyCommitPending(true);
    try {
      await deleteTaskDependency(dependencyDraft.id);
      setDependencyDraft(null);
      setDependencyEditorOpen(false);
      router.refresh();
      toast.success(t("dependencyDeleted"));
    } catch {
      toast.error(t("dependencySaveError"));
    } finally {
      setDependencyCommitPending(false);
    }
  }

  function activateConnectorResize() {
    const gesture = connectorGestureRef.current;
    if (
      !gesture ||
      gesture.activatedResize ||
      !gesture.task.startDate ||
      !gesture.task.dueDate
    ) {
      return;
    }
    gesture.activatedResize = true;
    clearTimeout(gesture.timer);
    draggedRef.current = true;
    const latest = {
      taskId: gesture.task.id,
      startDate: gesture.task.startDate,
      dueDate: gesture.task.dueDate,
    };
    dragRef.current = {
      pointerId: gesture.pointerId,
      mode: "end",
      task: gesture.task,
      startX: gesture.startX,
      timelineLeft: gesture.timelineLeft,
      latest,
    };
    setDragPreview({
      preview: null,
      draft: { ...latest, mode: "resize-end" },
      projectDraft: null,
    });
  }

  function startConnectorGesture(
    event: ReactPointerEvent<HTMLElement>,
    task: PortfolioTask,
  ) {
    if (
      scheduleCommitPending ||
      dependencyCommitPending ||
      dependencyEditorOpen ||
      !task.startDate ||
      !task.dueDate
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    const gesture = {
      pointerId,
      task,
      startX: event.clientX,
      timelineLeft:
        event.currentTarget.parentElement?.parentElement?.getBoundingClientRect()
          .left ?? 0,
      activatedResize: false,
      timer: setTimeout(() => {
        if (connectorGestureRef.current?.pointerId === pointerId) {
          activateConnectorResize();
        }
      }, 180),
    };
    connectorGestureRef.current = gesture;
  }

  function moveConnectorGesture(event: ReactPointerEvent<HTMLElement>) {
    const gesture = connectorGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (
      !gesture.activatedResize &&
      Math.abs(event.clientX - gesture.startX) > DRAG_CLICK_THRESHOLD
    ) {
      activateConnectorResize();
    }
    if (gesture.activatedResize) moveDrag(event);
  }

  function endConnectorGesture(event: ReactPointerEvent<HTMLElement>) {
    const gesture = connectorGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    clearTimeout(gesture.timer);
    connectorGestureRef.current = null;
    if (gesture.activatedResize) {
      endDrag(event);
      return;
    }
    draggedRef.current = true;
    setDependencySourceId((current) =>
      current === gesture.task.id ? null : gesture.task.id,
    );
    setDependencyHoverId(null);
    releaseDragFlag();
  }

  /** Opens the inspector, unless this click is the tail end of a drag. */
  function openTaskFromBar(task: PortfolioTask | undefined) {
    if (draggedRef.current || !task) return;
    if (dependencySourceId) {
      if (dependencySourceId === task.id) {
        setDependencySourceId(null);
      } else {
        void createGraphicalDependency(task.id);
      }
      return;
    }
    openTask(task);
  }

  /**
   * Releases the drag flag once the click that follows pointerup has been
   * dispatched. A macrotask is late enough for that click and early enough that
   * a cancelled gesture cannot leave the flag stuck.
   */
  function releaseDragFlag() {
    setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  }

  function clearDrag() {
    pendingPreviewRef.current = null;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    setDragPreview(null);
  }

  async function undoScheduleChange(changeSetId = undoChangeSetId) {
    if (!changeSetId || undoPending) return;
    setUndoPending(true);
    try {
      await revertPortfolioScheduleChange(changeSetId);
      setUndoChangeSetId(null);
      router.refresh();
      toast.success(t("scheduleRestored"));
    } catch {
      toast.error(t("undoUnavailable"));
    } finally {
      setUndoPending(false);
    }
  }

  function offerScheduleUndo(changeSetId: string | null) {
    if (!changeSetId) return;
    setUndoChangeSetId(changeSetId);
    toast.success(t("scheduleSaved"), {
      action: {
        label: t("undo"),
        onClick: () => {
          void undoScheduleChange(changeSetId);
        },
      },
    });
  }

  /**
   * Commits a drag straight from the drop and offers undo (R8). The server
   * recomputes the cascade itself, so nothing from the live preview is trusted
   * here; a concurrent edit surfaces as a rejected apply rather than silent loss.
   */
  async function commitSchedule(input: ScheduleEdit) {
    if (scheduleCommitPending) return;
    setScheduleCommitPending(true);
    try {
      const preview = localSchedulePreview(input);
      const result = await applyPortfolioScheduleChange({
        ...input,
        expectedPreview: { changes: preview.changes },
      });
      router.refresh();
      offerScheduleUndo(result.changeSetId);
    } catch (error) {
      clearDrag();
      router.refresh();
      toast.error(
        error instanceof Error && error.message.includes("another session")
          ? t("scheduleChanged")
          : tCommon("error"),
      );
    } finally {
      setScheduleCommitPending(false);
    }
  }

  function startDrag(event: ReactPointerEvent, task: PortfolioTask, mode: "move" | "start" | "end") {
    if (
      scheduleCommitPending ||
      dependencyCommitPending ||
      dependencyEditorOpen ||
      !task.startDate ||
      !task.dueDate
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    const latest = { taskId: task.id, startDate: task.startDate, dueDate: task.dueDate };
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      task,
      startX: event.clientX,
      timelineLeft: event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0,
      latest,
    };
    setDragPreview({
      preview: null,
      draft: { ...latest, mode: mode === "move" ? "move" : mode === "start" ? "resize-start" : "resize-end" },
      projectDraft: null,
    });
  }

  function startUnscheduledDrag(event: ReactPointerEvent, task: PortfolioTask) {
    if (
      scheduleCommitPending ||
      dependencyCommitPending ||
      dependencyEditorOpen ||
      task.startDate ||
      task.dueDate
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    const timelineLeft = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    const suggestion = rows.find((row) => row.task?.id === task.id)?.placement;
    const startDate =
      suggestion?.startDate ??
      addCalendarDays(
        addCalendarDays(
          range.start,
          Math.max(0, Math.round((event.clientX - timelineLeft) / dayWidth)),
        ),
        0,
      );
    const dueDate =
      suggestion?.dueDate ?? (task.isMilestone ? startDate : addCalendarDays(startDate, 4));
    const latest = { taskId: task.id, startDate, dueDate };
    dragRef.current = {
      pointerId: event.pointerId,
      mode: "place",
      task,
      startX: event.clientX,
      timelineLeft,
      latest,
    };
    const nextDraft = { ...latest, mode: "place" as const };
    previewCascade(taskScheduleEdit(task.id, "place", latest), nextDraft);
  }

  function moveDrag(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    trackDragMovement(event.clientX, drag.startX);
    if (drag.mode === "place") {
      const dayOffset = Math.max(
        0,
        Math.round((event.clientX - drag.timelineLeft) / dayWidth),
      );
      const startDate = addCalendarDays(range.start, dayOffset);
      drag.latest = {
        taskId: drag.task.id,
        startDate,
        dueDate: drag.task.isMilestone ? startDate : addCalendarDays(startDate, 4),
      };
      const nextDraft = { ...drag.latest, mode: "place" as const };
      queuePreview(taskScheduleEdit(drag.task.id, "place", drag.latest), nextDraft, null);
      return;
    }
    if (!drag.task.startDate || !drag.task.dueDate) return;
    const delta = Math.round((event.clientX - drag.startX) / dayWidth);
    let startDate = drag.task.startDate;
    let dueDate = drag.task.dueDate;
    if (drag.mode === "move") {
      startDate = addCalendarDays(drag.task.startDate, delta);
      dueDate = drag.task.isMilestone ? startDate : addCalendarDays(drag.task.dueDate, delta);
    } else if (drag.mode === "start") {
      startDate = addCalendarDays(drag.task.startDate, delta);
      if (startDate > dueDate) startDate = dueDate;
    } else {
      dueDate = addCalendarDays(drag.task.dueDate, delta);
      if (dueDate < startDate) dueDate = startDate;
    }
    drag.latest = { taskId: drag.task.id, startDate, dueDate };
    const nextDraft: TaskDraft = {
      ...drag.latest,
      mode: drag.mode === "move" ? "move" : drag.mode === "start" ? "resize-start" : "resize-end",
    };
    queuePreview(taskScheduleEdit(drag.task.id, drag.mode, drag.latest), nextDraft, null);
  }

  function taskScheduleEdit(
    taskId: string,
    mode: "move" | "start" | "end" | "place",
    latest: { startDate: string; dueDate: string },
  ): ScheduleEdit {
    return {
      entityType: "task",
      entityId: taskId,
      startDate: latest.startDate,
      dueDate: latest.dueDate,
      operation:
        mode === "start" ? "resize-start" : mode === "end" ? "resize-end" : mode,
    };
  }

  function endDrag(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releaseDragFlag();
    if (
      drag.latest.startDate === drag.task.startDate &&
      drag.latest.dueDate === drag.task.dueDate
    ) {
      clearDrag();
      return;
    }
    const edit = taskScheduleEdit(drag.task.id, drag.mode, drag.latest);
    const finalDraft: TaskDraft = {
      ...drag.latest,
      mode: drag.mode === "move" ? "move" : drag.mode === "start" ? "resize-start" : drag.mode === "end" ? "resize-end" : "place",
    };
    setDragPreview(atomicPreview(edit, finalDraft, null));
    void commitSchedule(edit);
  }

  function handleTaskScheduleKey(
    event: React.KeyboardEvent<HTMLButtonElement>,
    row: Row,
  ) {
    if (!row.task) return;
    if (
      event.altKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      void (event.key === "ArrowLeft"
        ? outdentRow(row.task)
        : indentRow(row.task));
      return;
    }
    if (event.key.toLocaleLowerCase() === "f" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      enterTaskFocus(row.task);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (dependencyEditorOpen || dependencyDraft) {
        cancelDependencyEditor();
      } else if (dependencySourceId) {
        setDependencySourceId(null);
        setDependencyHoverId(null);
      } else if (draft || projectDraft) clearDrag();
      else if (inspectorOpen) setInspectorOpen(false);
      else if (focusedTaskId) exitTaskFocus();
      return;
    }
    if (event.key === "Enter" && draft?.taskId === row.task.id) {
      event.preventDefault();
      void commitSchedule({
        entityType: "task",
        entityId: row.task.id,
        startDate: draft.startDate,
        dueDate: draft.dueDate,
        operation: row.task.startDate ? "move" : "place",
      });
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const baseStart =
      draft?.taskId === row.task.id
        ? draft.startDate
        : row.startDate ?? row.placement?.startDate;
    const baseDue =
      draft?.taskId === row.task.id
        ? draft.dueDate
        : row.dueDate ?? row.placement?.dueDate;
    if (!baseStart || !baseDue) return;
    const offset = (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 7 : 1);
    const nextDraft = {
      taskId: row.task.id,
      startDate: addCalendarDays(baseStart, offset),
      dueDate: addCalendarDays(baseDue, offset),
      mode: "move" as const,
    };
    previewCascade({
      entityType: "task",
      entityId: row.task.id,
      operation: row.task.startDate ? "move" : "place",
      startDate: nextDraft.startDate,
      dueDate: nextDraft.dueDate,
    }, nextDraft);
  }

  /**
   * Deleting a summary takes its whole subtree with it, so the count is spelled
   * out first and lifting the children out is offered as an alternative (R10).
   */
  function requestDeleteTask(task: PortfolioTask) {
    setPendingDelete({
      task,
      descendantCount: taskDescendants(schedule.tasks, task.id).length,
    });
  }

  async function confirmDeleteTask() {
    if (!pendingDelete) return;
    const { task } = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteTask(task.id);
      router.refresh();
      toast.success(tCommon("deleted"));
    } catch {
      toast.error(tCommon("error"));
    }
  }

  async function outdentChildrenThenDelete() {
    if (!pendingDelete) return;
    const { task } = pendingDelete;
    setPendingDelete(null);
    try {
      const children = schedule.tasks.filter((candidate) => candidate.parentTaskId === task.id);
      for (const child of children) {
        await reparentTask({ taskId: child.id, parentTaskId: task.parentTaskId ?? null });
      }
      await deleteTask(task.id);
      router.refresh();
      toast.success(tCommon("deleted"));
    } catch {
      toast.error(tCommon("error"));
    }
  }

  /**
   * Nests a task under the sibling above it (R5). The new parent turns into a
   * summary, so its own dates give way to the rollup of its children.
   */
  async function indentRow(task: PortfolioTask) {
    const siblings = schedule.tasks.filter((candidate) => candidate.projectId === task.projectId);
    const target = indentTarget(siblings, task.id);
    if (!target) {
      toast.error(t("indentUnavailable"));
      return;
    }
    try {
      await reparentTask({ taskId: task.id, parentTaskId: target.id });
      setExpandedTasks((current) => new Set(current).add(target.id));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("error"));
    }
  }

  /** Lifts a task out to its grandparent (R5). */
  async function outdentRow(task: PortfolioTask) {
    const siblings = schedule.tasks.filter((candidate) => candidate.projectId === task.projectId);
    const target = outdentTarget(siblings, task.id);
    if (target === undefined) {
      toast.error(t("outdentUnavailable"));
      return;
    }
    try {
      await reparentTask({ taskId: task.id, parentTaskId: target });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("error"));
    }
  }

  function startProjectDrag(
    event: ReactPointerEvent,
    project: PortfolioSchedule["projects"][number],
    row: Row,
    mode: "move" | "start" | "end",
  ) {
    if (
      scheduleCommitPending ||
      dependencyCommitPending ||
      dependencyEditorOpen ||
      !row.startDate ||
      !row.dueDate
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    const original = { startDate: row.startDate, dueDate: row.dueDate };
    projectDragRef.current = {
      pointerId: event.pointerId,
      mode,
      project,
      startX: event.clientX,
      original,
      latest: original,
    };
    setDragPreview({
      preview: null,
      draft: null,
      projectDraft: {
        projectId: project.id,
        ...original,
        mode: mode === "move" ? "move" : mode === "start" ? "resize-start" : "resize-end",
      },
    });
  }

  function startProjectPlacement(
    event: ReactPointerEvent,
    project: PortfolioSchedule["projects"][number],
    row: Row,
  ) {
    if (scheduleCommitPending || !row.placement) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    const original = {
      startDate: row.placement.startDate,
      dueDate: row.placement.dueDate,
    };
    projectDragRef.current = {
      pointerId: event.pointerId,
      mode: "place",
      project,
      startX: event.clientX,
      original,
      latest: original,
    };
    const nextProjectDraft = { projectId: project.id, ...original, mode: "place" as const };
    previewCascade(projectScheduleEdit(project.id, "place", original), null, nextProjectDraft);
  }

  function moveProjectDrag(event: ReactPointerEvent) {
    const drag = projectDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    trackDragMovement(event.clientX, drag.startX);
    const delta = Math.round((event.clientX - drag.startX) / dayWidth);
    let startDate = drag.original.startDate;
    let dueDate = drag.original.dueDate;
    if (drag.mode === "move" || drag.mode === "place") {
      startDate = addCalendarDays(startDate, delta);
      dueDate = addCalendarDays(dueDate, delta);
    } else if (drag.mode === "start") {
      startDate = addCalendarDays(startDate, delta);
      if (startDate > dueDate) startDate = dueDate;
    } else {
      dueDate = addCalendarDays(dueDate, delta);
      if (dueDate < startDate) dueDate = startDate;
    }
    drag.latest = { startDate, dueDate };
    const nextProjectDraft: ProjectDraft = {
      projectId: drag.project.id,
      ...drag.latest,
      mode: drag.mode === "move" || drag.mode === "place" ? drag.mode : drag.mode === "start" ? "resize-start" : "resize-end",
    };
    queuePreview(projectScheduleEdit(drag.project.id, drag.mode, drag.latest), null, nextProjectDraft);
  }

  function projectScheduleEdit(
    projectId: string,
    mode: "move" | "start" | "end" | "place",
    latest: { startDate: string; dueDate: string },
  ): ScheduleEdit {
    return {
      entityType: "project",
      entityId: projectId,
      startDate: latest.startDate,
      dueDate: latest.dueDate,
      operation:
        mode === "start" ? "resize-start" : mode === "end" ? "resize-end" : mode,
    };
  }

  function endProjectDrag(event: ReactPointerEvent) {
    const drag = projectDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    projectDragRef.current = null;
    releaseDragFlag();
    if (
      drag.mode !== "place" &&
      drag.latest.startDate === drag.original.startDate &&
      drag.latest.dueDate === drag.original.dueDate
    ) {
      clearDrag();
      return;
    }
    const edit = projectScheduleEdit(drag.project.id, drag.mode, drag.latest);
    const finalDraft: ProjectDraft = {
      projectId: drag.project.id,
      ...drag.latest,
      mode: drag.mode === "move" || drag.mode === "place" ? drag.mode : drag.mode === "start" ? "resize-start" : "resize-end",
    };
    setDragPreview(atomicPreview(edit, null, finalDraft));
    void commitSchedule(edit);
  }

  function deadlineTimestampForDate(
    deadlineAt: string | null,
    deadlineDate: string,
  ) {
    if (!deadlineAt) return null;
    const original = new Date(deadlineAt);
    const target = localDateValue(deadlineDate);
    if (!target || Number.isNaN(original.getTime())) return null;
    target.setHours(
      original.getHours(),
      original.getMinutes(),
      original.getSeconds(),
      original.getMilliseconds(),
    );
    return target.toISOString();
  }

  function queueDeadlinePreview(next: DeadlinePreview) {
    pendingDeadlinePreviewRef.current = next;
    if (deadlinePreviewFrameRef.current !== null) return;
    deadlinePreviewFrameRef.current = requestAnimationFrame(() => {
      deadlinePreviewFrameRef.current = null;
      const pending = pendingDeadlinePreviewRef.current;
      pendingDeadlinePreviewRef.current = null;
      if (pending) setDeadlinePreview(pending);
    });
  }

  function startDeadlineDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    deadline: PortfolioSchedule["deadlines"][number],
  ) {
    if (
      deadlineCommitPending ||
      dependencyCommitPending ||
      dependencyEditorOpen ||
      !deadline.dueDate
    ) {
      return;
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    deadlineDragRef.current = {
      pointerId: event.pointerId,
      deadline,
      startX: event.clientX,
      latestDate: deadline.dueDate,
    };
  }

  function moveDeadlineDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = deadlineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const movement = event.clientX - drag.startX;
    trackDragMovement(event.clientX, drag.startX);
    if (Math.abs(movement) <= DRAG_CLICK_THRESHOLD) return;
    const deadlineDate = addCalendarDays(
      drag.deadline.dueDate!,
      Math.round(movement / dayWidth),
    );
    drag.latestDate = deadlineDate;
    queueDeadlinePreview({
      id: drag.deadline.id,
      deadlineDate,
      deadlineAt: deadlineTimestampForDate(
        drag.deadline.deadlineAt,
        deadlineDate,
      ),
      updatedAt: drag.deadline.updatedAt,
    });
  }

  async function commitDeadlineMove(
    deadline: PortfolioSchedule["deadlines"][number],
    deadlineDate: string,
  ) {
    if (deadlineCommitPending) return;
    const next: DeadlinePreview = {
      id: deadline.id,
      deadlineDate,
      deadlineAt: deadlineTimestampForDate(deadline.deadlineAt, deadlineDate),
      updatedAt: deadline.updatedAt,
    };
    setDeadlinePreview(next);
    setDeadlineCommitPending(true);
    try {
      const result = await moveContextualDeadline({
        id: deadline.id,
        deadlineDate: next.deadlineDate,
        deadlineAt: next.deadlineAt,
        expectedUpdatedAt: deadline.updatedAt,
      });
      setDeadlinePreview({ id: deadline.id, ...result.current });
      router.refresh();
      toast.success(t("scheduleSaved"), {
        action: {
          label: t("undo"),
          onClick: () => {
            void (async () => {
              try {
                setDeadlinePreview({ id: deadline.id, ...result.previous });
                await moveContextualDeadline({
                  id: deadline.id,
                  deadlineDate: result.previous.deadlineDate,
                  deadlineAt: result.previous.deadlineAt,
                  expectedUpdatedAt: result.current.updatedAt,
                });
                router.refresh();
              } catch {
                setDeadlinePreview({ id: deadline.id, ...result.current });
                toast.error(t("undoUnavailable"));
              }
            })();
          },
        },
      });
    } catch (error) {
      setDeadlinePreview(null);
      toast.error(
        error instanceof Error && error.message.includes("another session")
          ? t("scheduleChanged")
          : tCommon("error"),
      );
    } finally {
      setDeadlineCommitPending(false);
    }
  }

  function endDeadlineDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = deadlineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    deadlineDragRef.current = null;
    releaseDragFlag();
    if (drag.latestDate === drag.deadline.dueDate) {
      setDeadlinePreview(null);
      return;
    }
    void commitDeadlineMove(drag.deadline, drag.latestDate);
  }

  function handleDeadlineKey(
    event: React.KeyboardEvent<HTMLButtonElement>,
    deadline: PortfolioSchedule["deadlines"][number],
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (!deadline.dueDate) return;
    event.preventDefault();
    const offset =
      (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 7 : 1);
    void commitDeadlineMove(
      deadline,
      addCalendarDays(deadline.dueDate, offset),
    );
  }

  function scrollToToday() {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    const todayOffset = calendarDistance(range.start, today) * dayWidth;
    const left = todayOffset - dayWidth * 7;
    scrollContainer.scrollTo({
      left: Math.max(0, left),
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }

  function fitTimelineView() {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    const availableTimelineWidth = Math.max(
      240,
      scrollContainer.clientWidth - treeWidth - 12,
    );
    setTimelineDayWidth(availableTimelineWidth / Math.max(1, baseDayCount));
    requestAnimationFrame(() => {
      scrollContainer.scrollTo({
        left: 0,
        behavior: reducedMotion ? "auto" : "smooth",
      });
    });
  }

  function setTimelineDayWidth(nextDayWidth: number) {
    const clamped = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, nextDayWidth));
    dayWidthRef.current = clamped;
    setDayWidth(clamped);
    setZoom(zoomModeForDayWidth(clamped));
  }

  function setTimelineZoom(nextZoom: Zoom) {
    setTimelineDayWidth(ZOOM_WIDTH[nextZoom]);
  }

  function handleTimelineWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const scrollContainer = event.currentTarget;
    const bounds = scrollContainer.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const currentDayWidth = dayWidthRef.current;
    const nextDayWidth = Math.min(
      MAX_DAY_WIDTH,
      Math.max(MIN_DAY_WIDTH, currentDayWidth * Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY)),
    );
    if (Math.abs(nextDayWidth - currentDayWidth) < 0.01) return;
    const anchorDay = (scrollContainer.scrollLeft + pointerX - treeWidth) / currentDayWidth;
    setTimelineDayWidth(nextDayWidth);
    requestAnimationFrame(() => {
      const nextScrollLeft = treeWidth + anchorDay * nextDayWidth - pointerX;
      scrollContainer.scrollTo({ left: Math.max(0, nextScrollLeft), behavior: "auto" });
    });
  }

  // Summaries can sit at either end of a dependency (R6), so they need to be
  // addressable here too or their arrows would never be drawn.
  const rowIndex = new Map(
    rows.flatMap((row, index) => (row.task ? [[row.id, index] as const] : [])),
  );
  const taskRows = new Map(rows.filter((row) => row.task).map((row) => [row.id, row]));
  const renderedDependencies = effectiveSchedule.dependencies.filter(
    (dependency) =>
      !visibleFocusDependencyIds ||
      visibleFocusDependencyIds.has(dependency.id) ||
      dependencyDraft?.id === dependency.id,
  );
  const dependencySourceGroups = new Map<string, string[]>();
  const dependencyTargetGroups = new Map<string, string[]>();
  for (const dependency of renderedDependencies) {
    const endpoints = dependencyEndpoints(dependency);
    const sourceKey = `${dependency.predecessorTaskId}:${endpoints.predecessor}`;
    const targetKey = `${dependency.successorTaskId}:${endpoints.successor}`;
    dependencySourceGroups.set(sourceKey, [
      ...(dependencySourceGroups.get(sourceKey) ?? []),
      dependency.id,
    ]);
    dependencyTargetGroups.set(targetKey, [
      ...(dependencyTargetGroups.get(targetKey) ?? []),
      dependency.id,
    ]);
  }
  function endpointFanOffset(
    groups: Map<string, string[]>,
    key: string,
    dependencyId: string,
  ) {
    const group = groups.get(key) ?? [];
    const index = group.indexOf(dependencyId);
    if (index < 0 || group.length < 2) return 0;
    return Math.max(
      -10,
      Math.min(10, (index - (group.length - 1) / 2) * 10),
    );
  }
  const dependencyRoutes = new Map(
    renderedDependencies.map((dependency, index) => {
      const endpoints = dependencyEndpoints(dependency);
      const laneStep =
        index === 0
          ? 0
          : Math.ceil(index / 2) * 10 * (index % 2 === 1 ? 1 : -1);
      return [
        dependency.id,
        {
          sourceOffsetY: endpointFanOffset(
            dependencySourceGroups,
            `${dependency.predecessorTaskId}:${endpoints.predecessor}`,
            dependency.id,
          ),
          targetOffsetY: endpointFanOffset(
            dependencyTargetGroups,
            `${dependency.successorTaskId}:${endpoints.successor}`,
            dependency.id,
          ),
          laneOffset: laneStep,
        },
      ] as const;
    }),
  );
  const dependencyObstacles: GanttRouteObstacle[] = rows.flatMap(
    (row, index) => {
      if (!row.task || !row.startDate || !row.dueDate) return [];
      return [
        {
          id: row.id,
          left:
            calendarDistance(range.start, row.startDate) * dayWidth - 6,
          right:
            (calendarDistance(range.start, row.dueDate) + 1) * dayWidth + 6,
          top: index * ROW_HEIGHT + 8,
          bottom: (index + 1) * ROW_HEIGHT - 8,
        },
      ];
    },
  );
  const dependencyGeometries = new Map<
    string,
    NonNullable<ReturnType<typeof dependencyPathGeometry>>
  >();
  const occupiedDependencyRoutes: GanttRoutePoint[][] = [];
  for (const dependency of renderedDependencies) {
    const fromIndex = rowIndex.get(dependency.predecessorTaskId);
    const toIndex = rowIndex.get(dependency.successorTaskId);
    const from = taskRows.get(dependency.predecessorTaskId);
    const to = taskRows.get(dependency.successorTaskId);
    if (
      fromIndex === undefined ||
      toIndex === undefined ||
      !from ||
      !to
    ) {
      continue;
    }
    const geometry = dependencyPathGeometry({
      dependency,
      predecessor: from,
      successor: to,
      predecessorIndex: fromIndex,
      successorIndex: toIndex,
      rangeStart: range.start,
      dayWidth,
      obstacles: dependencyObstacles,
      occupiedRoutes: occupiedDependencyRoutes,
      ...dependencyRoutes.get(dependency.id),
    });
    if (!geometry) continue;
    dependencyGeometries.set(dependency.id, geometry);
    occupiedDependencyRoutes.push(geometry.points);
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        focusedTask ? "gap-3" : "gap-5",
      )}
      data-focused-task-id={focusedTask?.id}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (dependencyEditorOpen || dependencyDraft) cancelDependencyEditor();
        else if (dependencySourceId) {
          setDependencySourceId(null);
          setDependencyHoverId(null);
        } else if (draft || projectDraft) clearDrag();
        else if (inspectorOpen) setInspectorOpen(false);
        else if (focusedTaskId) exitTaskFocus();
      }}
    >
      {focusedTask && focusedProject ? (
        <section
          className="relative overflow-hidden rounded-xl border bg-card shadow-xs"
          aria-label={t("focusMode")}
          data-testid="gantt-focus-rail"
        >
          <span
            className="absolute inset-y-0 left-0 w-1"
            style={{ backgroundColor: focusedProject.color }}
            aria-hidden
          />
          <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 pl-4">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={exitTaskFocus}
              aria-label={t("exitFocus")}
              title={t("exitFocus")}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="min-w-[14rem] flex-1">
              <nav
                className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
                aria-label={t("taskBreadcrumb")}
              >
                {focusBreadcrumbs.map((item, index) => (
                  <span key={`${item.id}-${index}`} className="contents">
                    {index > 0 && <ChevronRight className="size-3 shrink-0" aria-hidden />}
                    <span
                      className={cn(
                        "truncate",
                        index === focusBreadcrumbs.length - 1 &&
                          "font-medium text-foreground",
                      )}
                    >
                      {item.label}
                    </span>
                  </span>
                ))}
              </nav>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong className="truncate text-sm font-semibold">
                  {focusedTask.title}
                </strong>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {focusedTask.progress}%
                  {focusedTask.startDate && focusedTask.dueDate
                    ? ` · ${focusedTask.startDate} – ${focusedTask.dueDate}`
                    : ` · ${t("unscheduled")}`}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {incomingExternalTasks.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="xs">
                        <ArrowRight className="size-3" />
                        {t("incomingDependencies", {
                          count: incomingExternalTasks.length,
                        })}
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-64">
                    {incomingExternalTasks.map((task) => (
                      <DropdownMenuItem
                        key={task.id}
                        onClick={() => enterTaskFocus(task)}
                      >
                        <ArrowRight className="size-3.5" />
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                        <DropdownMenuShortcut>{t("jumpToTask")}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {outgoingExternalTasks.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="xs">
                        <ArrowLeft className="size-3" />
                        {t("outgoingDependencies", {
                          count: outgoingExternalTasks.length,
                        })}
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end" className="w-64">
                    {outgoingExternalTasks.map((task) => (
                      <DropdownMenuItem
                        key={task.id}
                        onClick={() => enterTaskFocus(task)}
                      >
                        <ArrowLeft className="size-3.5" />
                        <span className="min-w-0 flex-1 truncate">{task.title}</span>
                        <DropdownMenuShortcut>{t("jumpToTask")}</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button size="icon-sm" variant="ghost" onClick={copyFocusLink} aria-label={t("copyFocusLink")} title={t("copyFocusLink")}><Copy className="size-4" /></Button>
              <Button size="sm" variant="outline" className="hidden md:inline-flex" onClick={fitTimelineView}><Minimize2 className="size-4" />{t("fitView")}</Button>
              <Button size="icon-sm" variant="ghost" className="hidden md:inline-flex" onClick={scrollToToday} aria-label={t("today")} title={t("today")}><LocateFixed className="size-4" /></Button>
              <div className="hidden rounded-md border p-0.5 md:flex">
                {(["week", "month", "quarter"] as const).map((option) => (
                  <Button
                    key={option}
                    size="xs"
                    variant={zoom === option ? "secondary" : "ghost"}
                    onClick={() => setTimelineZoom(option)}
                  >
                    {t(option)}
                  </Button>
                ))}
              </div>
              <Button
                size="icon-sm"
                variant={criticalVisible ? "secondary" : "ghost"}
                className="hidden md:inline-flex"
                onClick={() => setCriticalVisible((value) => !value)}
                aria-label={t("criticalPath")}
                title={t("criticalPath")}
              >
                <GitBranch className="size-4" />
              </Button>
            </div>
          </div>
        </section>
      ) : (
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{t("activeProjectCount", { count: schedule.projects.length })}</span>
            <span aria-hidden>·</span>
            <span className={cn(riskCount > 0 && "text-amber-700 dark:text-amber-400")}>{t("riskProjectCount", { count: riskCount })}</span>
            {nextMilestone?.dueDate && (
              <>
                <span aria-hidden>·</span>
                <span>{t("nextMilestone")}: {format.dateTime(parseDate(nextMilestone.dueDate), { day: "2-digit", month: "short" })}</span>
              </>
            )}
          </div>
        </div>
        <Button size="sm" onClick={() => setProjectDialogOpen(true)}><Plus className="size-4" />{t("newProject")}</Button>
      </header>
      )}

      {!focusedTask && <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <div className="flex rounded-md bg-muted p-1">
          <Button size="sm" variant={view === "timeline" ? "secondary" : "ghost"} onClick={() => setView("timeline")}><CalendarClock className="size-4" />{t("timeline")}</Button>
          <Button size="sm" variant={view === "projects" ? "secondary" : "ghost"} onClick={() => setView("projects")}><FolderKanban className="size-4" />{t("projectOverview")}</Button>
        </div>
        {view === "timeline" && (
          <>
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchSchedule")}
                className="pl-8"
                role="combobox"
                aria-expanded={Boolean(query.trim())}
                aria-controls="schedule-search-results"
              />
              {query.trim() && (
                <div
                  id="schedule-search-results"
                  className="absolute top-[calc(100%+0.35rem)] left-0 z-50 w-full min-w-72 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
                  role="listbox"
                >
                  {searchResults.projects.length > 0 && (
                    <>
                      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {t("projectsGroup")}
                      </p>
                      {searchResults.projects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                          onClick={() => revealProject(project.id)}
                        >
                          <span className="size-2 rounded-full" style={{ backgroundColor: project.color }} />
                          <span className="truncate">{project.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {searchResults.tasks.length > 0 && (
                    <>
                      <p className="mt-1 border-t px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {t("tasksGroup")}
                      </p>
                      {searchResults.tasks.map((task) => {
                        const project = schedule.projects.find((candidate) => candidate.id === task.projectId);
                        return (
                          <button
                            key={task.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                            onClick={() => {
                              setQuery("");
                              enterTaskFocus(task);
                            }}
                          >
                            <Focus className="size-3.5 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate">{task.title}</span>
                            <span className="max-w-24 truncate text-[10px] text-muted-foreground">{project?.name}</span>
                          </button>
                        );
                      })}
                    </>
                  )}
                  {searchResults.projects.length === 0 && searchResults.tasks.length === 0 && (
                    <p className="px-2 py-5 text-center text-xs text-muted-foreground">
                      {t("noSearchResults")}
                    </p>
                  )}
                </div>
              )}
            </div>
            <Select value={owner} onValueChange={(value) => setOwner(value ?? "all")}><SelectTrigger className="w-36"><SelectValue>{owner === "all" ? t("allOwners") : schedule.members.find((member) => member.id === owner)?.name ?? t("allOwners")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">{t("allOwners")}</SelectItem>{schedule.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent></Select>
            <Select value={health} onValueChange={(value) => setHealth((value ?? "all") as typeof health)}><SelectTrigger className="w-32"><SelectValue>{health === "risk" ? t("atRisk") : health === "track" ? t("onTrack") : t("allHealth")}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">{t("allHealth")}</SelectItem><SelectItem value="track">{t("onTrack")}</SelectItem><SelectItem value="risk">{t("atRisk")}</SelectItem></SelectContent></Select>
            <div className="ml-auto hidden rounded-md border p-0.5 md:flex">
              {(["week", "month", "quarter"] as const).map((option) => <Button key={option} size="xs" variant={zoom === option ? "secondary" : "ghost"} onClick={() => setTimelineZoom(option)}>{t(option)}</Button>)}
            </div>
            <Button size="sm" variant="outline" className="hidden md:inline-flex" onClick={fitTimelineView}><Minimize2 className="size-4" />{t("fitView")}</Button>
            <Button size="sm" variant="outline" className="hidden md:inline-flex" onClick={scrollToToday}><LocateFixed className="size-4" />{t("today")}</Button>
            <Button size="sm" variant={criticalVisible ? "secondary" : "outline"} className="hidden md:inline-flex" onClick={() => setCriticalVisible((value) => !value)}><GitBranch className="size-4" />{t("criticalPath")}</Button>
          </>
        )}
      </div>}

      {view === "projects" && !focusedTask ? (
        <ProjectsClient projects={projects} members={schedule.members} predecessorOptions={[
          ...schedule.projects.map((project) => ({ id: project.id, title: project.name, dueDate: project.targetEndDate, type: "project" as const })),
          ...schedule.tasks.map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, type: "task" as const })),
        ]} />
      ) : (
        <div className="flex min-h-0 min-w-0 overflow-hidden rounded-lg border bg-card">
          <div className="min-w-0 flex-1">
          {dependencySourceId && (
            <div
              className="flex min-h-9 items-center gap-2 border-b border-indigo-200 bg-indigo-50/90 px-3 text-xs text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/35 dark:text-indigo-100"
              role="status"
              aria-live="polite"
              data-testid="dependency-linking-strip"
            >
              <GitBranch className="size-3.5 text-indigo-600 dark:text-indigo-400" />
              <span className="font-medium">
                {t("dependencyLinkingSource", {
                  name:
                    schedule.tasks.find(
                      (task) => task.id === dependencySourceId,
                    )?.title ?? "",
                })}
              </span>
              <span className="text-indigo-700/80 dark:text-indigo-300/80">
                {t("dependencyLinkingHint")}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  setDependencySourceId(null);
                  setDependencyHoverId(null);
                }}
              >
                {tCommon("cancel")}
              </Button>
            </div>
          )}
          {!dependencySourceId && dragImpact && (
            <div
              className="flex min-h-8 items-center gap-2 border-b bg-amber-50/80 px-3 font-mono text-[11px] tabular-nums text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
              role="status"
              aria-live="polite"
              data-testid="schedule-impact-strip"
            >
              <GitBranch className="size-3.5" />
              <span>
                {t("dragImpact", {
                  days: dragImpact.days,
                  tasks: dragImpact.taskCount,
                  containers: dragImpact.containerCount,
                })}
              </span>
              {dragImpact.constrained && (
                <span className="rounded-sm border border-amber-600/30 bg-amber-100/80 px-1.5 py-0.5 font-sans font-medium dark:bg-amber-900/50">
                  {t("limitedByChildren")}
                </span>
              )}
            </div>
          )}
          <div className="grid gap-2 p-2 md:hidden" role="tree" aria-label={t("workBreakdown")}>
            {!focusedTask && schedule.deadlines.map((deadline) => {
              const separator = deadline.contextRoute?.includes("?") ? "&" : "?";
              const href = deadline.contextRoute
                ? `${deadline.contextRoute}${separator}deadline=${encodeURIComponent(deadline.id)}`
                : "/";
              const localDate = localDateValue(deadline.dueDate ?? "");
              const deadlineLabel = deadline.deadlineAt
                ? format.dateTime(new Date(deadline.deadlineAt), { dateStyle: "medium", timeStyle: "short" })
                : `${localDate ? format.dateTime(localDate, { dateStyle: "medium" }) : deadline.dueDate} · ${tDeadlines("allDay")}`;
              return (
                <button
                  key={deadline.id}
                  type="button"
                  onClick={() => router.push(href)}
                  className="grid grid-cols-[auto_1fr] items-center gap-3 rounded-lg border border-amber-300 bg-amber-50/50 p-3 text-left dark:border-amber-800 dark:bg-amber-950/20"
                >
                  <Diamond className="size-4 rotate-45 fill-amber-500 text-amber-600" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{deadline.title}</span>
                    <span className="block text-xs text-muted-foreground">{deadlineLabel}</span>
                  </span>
                </button>
              );
            })}
            {rows.filter((row) => row.kind === "task" || row.kind === "subtask").map((row) => (
              <button
                key={row.id}
                type="button"
                role="treeitem"
                aria-level={(row.depth ?? 0) + 1}
                aria-expanded={row.isSummary ? expandedTasks.has(row.id) : undefined}
                aria-selected={selectedTaskId === row.task?.id}
                aria-current={selectedTaskId === row.task?.id ? "true" : undefined}
                onClick={() => row.task && openTask(row.task)}
                onKeyDown={(event) => handleTaskScheduleKey(event, row)}
                className={cn(
                  "grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border bg-card p-3 text-left",
                  row.kind === "subtask" && "border-l-2 border-l-indigo-400",
                  selectedTaskId === row.task?.id && "outline-2 outline-indigo-600",
                )}
                style={{ marginLeft: Math.min(row.depth ?? 0, 6) * 16 }}
              >
                {row.isMilestone ? <Diamond className="size-4 fill-indigo-500 text-indigo-600" /> : <span className="size-2.5 rounded-full" style={{ backgroundColor: row.color }} />}
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{row.label}</span><span className="block text-xs text-muted-foreground">{row.startDate ?? t("unscheduled")}{row.dueDate && !row.isMilestone ? ` – ${row.dueDate}` : ""}</span></span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{row.progress}%</span>
              </button>
            ))}
          </div>

          <div
            ref={scrollRef}
            onWheel={handleTimelineWheel}
            className={cn(
              "gantt-scrollbar hidden overflow-auto bg-card md:block",
              focusedTask
                ? "max-h-[calc(100dvh-7.5rem)]"
                : "max-h-[calc(100dvh-15rem)]",
            )}
            data-testid="portfolio-gantt"
            role="tree"
            aria-label={t("workBreakdown")}
          >
            <div className="relative" style={{ width: totalWidth, minHeight: Math.max(totalHeight, 280) }}>
              <div className="sticky top-0 z-30 flex h-[54px] border-b bg-card/95 backdrop-blur" style={{ width: totalWidth }}>
                <div
                  className="sticky left-0 z-40 flex shrink-0 items-center border-r bg-card px-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground"
                  style={{ width: treeWidth }}
                >
                  {t("workBreakdown")}
                  <span
                    role="separator"
                    aria-label={t("resizeWorkBreakdown")}
                    aria-orientation="vertical"
                    tabIndex={0}
                    className="absolute inset-y-0 right-0 z-50 w-1.5 cursor-col-resize bg-transparent hover:bg-violet-400/50 focus-visible:bg-violet-500"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      treeResizeRef.current = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        width: treeWidth,
                      };
                    }}
                    onPointerMove={(event) => {
                      const resize = treeResizeRef.current;
                      if (!resize || resize.pointerId !== event.pointerId) return;
                      setTreeWidth(
                        Math.min(640, Math.max(280, resize.width + event.clientX - resize.startX)),
                      );
                    }}
                    onPointerUp={(event) => {
                      if (treeResizeRef.current?.pointerId === event.pointerId) {
                        treeResizeRef.current = null;
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      setTreeWidth((width) =>
                        Math.min(640, Math.max(280, width + (event.key === "ArrowRight" ? 16 : -16))),
                      );
                    }}
                  />
                </div>
                <div className="relative h-full" style={{ width: timelineWidth }}>
                  {Array.from({ length: dayCount }, (_, index) => {
                    const date = addCalendarDays(range.start, index);
                    const parsed = parseDate(date);
                    const day = parsed.getUTCDay();
                    const show = zoom === "week" ? true : zoom === "month" ? day === 1 : parsed.getUTCDate() === 1;
                    if (!show) return null;
                    return (
                      <span key={date} className="absolute top-0 flex h-full flex-col items-start justify-center border-l px-1.5 font-mono text-[10px] leading-tight text-muted-foreground" style={{ left: index * dayWidth, width: zoom === "week" ? dayWidth : zoom === "month" ? dayWidth * 7 : dayWidth * 30 }}>
                        {zoom === "month" && <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-foreground/70">{t("calendarWeek", { week: calendarWeek(parsed) })}</span>}
                        <span>{format.dateTime(parsed, zoom === "quarter" ? { month: "short", year: "2-digit" } : { day: "2-digit", month: "short" })}</span>
                      </span>
                    );
                  })}
                  {today >= range.start && today <= renderedRangeEnd && (
                    <span
                      className="pointer-events-none absolute bottom-1 z-20 -translate-x-1/2 rounded-full bg-red-600 px-1.5 py-0.5 font-sans text-[9px] font-semibold text-white shadow-sm"
                      style={{
                        left:
                          calendarDistance(range.start, today) * dayWidth +
                          dayWidth / 2,
                      }}
                    >
                      {t("today")}
                    </span>
                  )}
                </div>
              </div>

              <div className="pointer-events-none absolute z-0" style={{ left: treeWidth, top: HEADER_HEIGHT, width: timelineWidth, height: deadlineLaneHeight + rows.length * ROW_HEIGHT }}>
                {Array.from({ length: dayCount }, (_, index) => {
                  const date = addCalendarDays(range.start, index);
                  const day = parseDate(date).getUTCDay();
                  return day === 0 || day === 6 ? <span key={date} className="absolute inset-y-0 bg-slate-100/45 dark:bg-slate-900/25" style={{ left: index * dayWidth, width: dayWidth }} /> : null;
                })}
                {Array.from({ length: dayCount }, (_, index) => {
                  const date = addCalendarDays(range.start, index);
                  if (index === 0 || parseDate(date).getUTCDay() !== 1) {
                    return null;
                  }
                  return (
                    <span
                      key={`week-${date}`}
                      className="absolute inset-y-0 w-px bg-border/80"
                      style={{ left: index * dayWidth }}
                    />
                  );
                })}
                {today >= range.start && today <= renderedRangeEnd && <span className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-red-500/90" style={{ left: calendarDistance(range.start, today) * dayWidth + dayWidth / 2 }} />}
              </div>

              <svg
                className="pointer-events-none absolute z-[8] overflow-visible"
                style={{ left: treeWidth, top: HEADER_HEIGHT + deadlineLaneHeight, width: timelineWidth, height: rows.length * ROW_HEIGHT }}
              >
                <defs>
                  {[
                    ["gantt-dependency-arrow", "#64748b"],
                    ["gantt-dependency-arrow-active", "#4f46e5"],
                    ["gantt-dependency-arrow-conflict", "#ef4444"],
                  ].map(([id, fill]) => (
                    <marker
                      key={id}
                      id={id}
                      markerWidth="7"
                      markerHeight="7"
                      refX="6"
                      refY="3.5"
                      orient="auto"
                      markerUnits="strokeWidth"
                    >
                      <path d="M 0 0 L 7 3.5 L 0 7 Z" fill={fill} />
                    </marker>
                  ))}
                </defs>
                {renderedDependencies.map((dependency) => {
                  const fromIndex = rowIndex.get(dependency.predecessorTaskId);
                  const toIndex = rowIndex.get(dependency.successorTaskId);
                  const from = taskRows.get(dependency.predecessorTaskId);
                  const to = taskRows.get(dependency.successorTaskId);
                  if (fromIndex === undefined || toIndex === undefined || !from || !to) return null;
                  const geometry = dependencyGeometries.get(dependency.id);
                  if (!geometry) return null;
                  const selected = dependencyDraft?.id === dependency.id;
                  const hovered = hoveredDependencyId === dependency.id;
                  const conflict = conflicts.has(dependency.successorTaskId);
                  const predecessorTitle =
                    effectiveSchedule.tasks.find(
                      (task) => task.id === dependency.predecessorTaskId,
                    )?.title ?? "";
                  const successorTitle =
                    effectiveSchedule.tasks.find(
                      (task) => task.id === dependency.successorTaskId,
                    )?.title ?? "";
                  const label = t("dependencyAriaLabel", {
                    predecessor: predecessorTitle,
                    successor: successorTitle,
                    type: t(
                      dependencyTypeTranslationKey(
                        dependencyTypeOf(dependency),
                      ),
                    ),
                  });
                  return (
                    <g key={dependency.id}>
                      <path
                        d={geometry.path}
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={selected || hovered ? 2.25 : 1.4}
                        markerEnd={
                          conflict
                            ? "url(#gantt-dependency-arrow-conflict)"
                            : selected || hovered
                              ? "url(#gantt-dependency-arrow-active)"
                              : "url(#gantt-dependency-arrow)"
                        }
                        className={cn(
                          "transition-[stroke-width,color,opacity] duration-150 motion-reduce:transition-none",
                          conflict
                            ? "text-red-500"
                            : selected || hovered
                              ? "text-indigo-600 dark:text-indigo-400"
                              : "text-slate-400 dark:text-slate-600",
                        )}
                      />
                      <path
                        d={geometry.path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="14"
                        role="button"
                        tabIndex={0}
                        aria-label={label}
                        style={{
                          pointerEvents: "stroke",
                          cursor: "pointer",
                        }}
                        onPointerEnter={() =>
                          setHoveredDependencyId(dependency.id)
                        }
                        onPointerLeave={() =>
                          setHoveredDependencyId((current) =>
                            current === dependency.id ? null : current,
                          )
                        }
                        onFocus={() => setHoveredDependencyId(dependency.id)}
                        onBlur={() => setHoveredDependencyId(null)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          selectDependency(dependency);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            openDependencyEditor(dependency);
                          } else {
                            selectDependency(dependency);
                          }
                        }}
                      />
                      {selected &&
                        !dependencyDraft?.isNew &&
                        (["x", "y"] as const).map((axis) => {
                          const handle = geometry.handles[axis];
                          if (!handle) return null;
                          return (
                            <DependencyRouteHandle
                              key={axis}
                              axis={axis}
                              point={handle}
                              dragging={dependencyRouteDragging === axis}
                              label={t(
                                axis === "x"
                                  ? "dependencyRouteHandleX"
                                  : "dependencyRouteHandleY",
                              )}
                              valueText={
                                dependency.routeOffsetDays === null &&
                                dependency.routeOffsetRows === null
                                  ? t("dependencyRouteAutomatic")
                                  : t("dependencyRouteManual")
                              }
                              onPointerDown={beginDependencyRouteDrag}
                              onKeyDown={nudgeDependencyRoute}
                            />
                          );
                        })}
                    </g>
                  );
                  })}
                {dependencySourceId && dependencyHoverId && (() => {
                  const fromIndex = rowIndex.get(dependencySourceId);
                  const toIndex = rowIndex.get(dependencyHoverId);
                  const from = taskRows.get(dependencySourceId);
                  const to = taskRows.get(dependencyHoverId);
                  if (fromIndex === undefined || toIndex === undefined || !from || !to) {
                    return null;
                  }
                  const previewDependency: PortfolioDependency = {
                    id: `preview-${dependencySourceId}-${dependencyHoverId}`,
                    predecessorTaskId: dependencySourceId,
                    successorTaskId: dependencyHoverId,
                    dependencyType: "finish_to_start",
                    lagDays: 0,
                    routeOffsetDays: null,
                    routeOffsetRows: null,
                    createdAt: new Date(),
                  };
                  const geometry = dependencyPathGeometry({
                    dependency: previewDependency,
                    predecessor: from,
                    successor: to,
                    predecessorIndex: fromIndex,
                    successorIndex: toIndex,
                    rangeStart: range.start,
                    dayWidth,
                    obstacles: dependencyObstacles,
                    occupiedRoutes: occupiedDependencyRoutes,
                  });
                  if (!geometry) return null;
                  return (
                    <path
                      d={geometry.path}
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="4 3"
                      strokeWidth="2"
                      markerEnd="url(#gantt-dependency-arrow-active)"
                      className="text-indigo-500"
                    />
                  );
                })()}
              </svg>

                {renderedDependencies.map((dependency) => {
                  const fromIndex = rowIndex.get(dependency.predecessorTaskId);
                  const toIndex = rowIndex.get(dependency.successorTaskId);
                  const from = taskRows.get(dependency.predecessorTaskId);
                  const to = taskRows.get(dependency.successorTaskId);
                  if (fromIndex === undefined || toIndex === undefined || !from || !to) return null;
                  const geometry = dependencyGeometries.get(dependency.id);
                  if (!geometry) return null;
                  const selected =
                    dependencyDraft?.id === dependency.id &&
                    dependencyEditorOpen;
                  return (
                    <Popover
                      key={`label-${dependency.id}`}
                      open={selected}
                      onOpenChange={(nextOpen) => {
                        if (nextOpen) openDependencyEditor(dependency);
                        else if (selected) cancelDependencyEditor();
                      }}
                    >
                      <PopoverTrigger
                        render={
                          <button
                            type="button"
                            aria-label={t("dependencyRouteHandle")}
                            title={t("dependencyRouteHandle")}
                            className={cn(
                              "pointer-events-none absolute z-[6] size-1 -translate-x-1/2 -translate-y-1/2 opacity-0",
                            )}
                            style={{
                              left: treeWidth + geometry.labelX,
                              top:
                                HEADER_HEIGHT +
                                deadlineLaneHeight +
                                geometry.labelY,
                            }}
                          />
                        }
                      />
                      <PopoverContent
                        side="bottom"
                        align="center"
                        className="w-[min(25rem,calc(100vw-2rem))] p-3"
                      >
                        <div className="mb-1">
                          <h3 className="text-sm font-semibold">
                            {dependencyDraft?.isNew
                              ? t("createDependency")
                              : t("editDependency")}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {t("dependencyEditorDescription")}
                          </p>
                        </div>
                        {dependencyDraft &&
                          dependencyDraft.id === dependency.id && (
                            <DependencyEditorPanel
                              draft={dependencyDraft}
                              tasks={effectiveSchedule.tasks}
                              pending={dependencyCommitPending}
                              invalid={dependencyDraftIsInvalid(
                                schedule.tasks,
                                schedule.dependencies,
                                dependencyDraft,
                              )}
                              onChange={setDependencyDraft}
                              onSave={() => void saveGraphicalDependency()}
                              onCancel={cancelDependencyEditor}
                              onDelete={() =>
                                void deleteGraphicalDependency()
                              }
                            />
                          )}
                      </PopoverContent>
                    </Popover>
                  );
                })}

              {deadlineLaneHeight > 0 && (
                <div
                  data-row-kind="deadlines"
                  role="treeitem"
                  aria-level={1}
                  aria-selected={false}
                  className="relative z-[2] flex border-b bg-amber-50/15 dark:bg-amber-950/5"
                  style={{ width: totalWidth, height: DEADLINE_LANE_HEIGHT }}
                >
                  <div
                    className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-l-2 border-l-amber-500 bg-card/95 px-3 font-semibold"
                    style={{ width: treeWidth }}
                  >
                    <CalendarClock className="size-3.5 text-amber-600" />
                    <span className="truncate text-xs">{tDeadlines("ganttLane")}</span>
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">{effectiveSchedule.deadlines.length}</span>
                  </div>
                  <div className="relative" style={{ width: timelineWidth }}>
                    {effectiveSchedule.deadlines.map((deadline) => {
                      if (!deadline.dueDate || deadline.dueDate < range.start || deadline.dueDate > renderedRangeEnd) return null;
                      const overdue = isDeadlineOverdue({
                        deadlineDate: deadline.dueDate,
                        deadlineAt: deadline.deadlineAt,
                        status: deadline.status,
                      }, renderedAt);
                      const separator = deadline.contextRoute?.includes("?") ? "&" : "?";
                      const href = deadline.contextRoute
                        ? `${deadline.contextRoute}${separator}deadline=${encodeURIComponent(deadline.id)}`
                        : "/";
                      const localDate = localDateValue(deadline.dueDate);
                      const deadlineLabel = deadline.deadlineAt
                        ? format.dateTime(new Date(deadline.deadlineAt), { dateStyle: "medium", timeStyle: "short" })
                        : `${localDate ? format.dateTime(localDate, { dateStyle: "medium" }) : deadline.dueDate} · ${tDeadlines("allDay")}`;
                      return (
                        <button
                          key={deadline.id}
                          type="button"
                          data-deadline-id={deadline.id}
                          onClick={() => {
                            if (!draggedRef.current) router.push(href);
                          }}
                          onPointerDown={(event) => startDeadlineDrag(event, deadline)}
                          onPointerMove={moveDeadlineDrag}
                          onPointerUp={endDeadlineDrag}
                          onPointerCancel={endDeadlineDrag}
                          onKeyDown={(event) => handleDeadlineKey(event, deadline)}
                          className={cn(
                            "absolute top-1/2 grid size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize touch-none place-items-center rounded-[2px] border-2 bg-card shadow-xs transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-ring",
                            deadline.status === "done" && "opacity-45",
                          )}
                          style={{
                            left: calendarDistance(range.start, deadline.dueDate) * dayWidth + dayWidth / 2,
                            borderColor: deadline.status === "done" ? "#059669" : overdue ? "#dc2626" : "#d97706",
                          }}
                          title={`${deadline.title} · ${deadlineLabel} · ${deadline.assigneeName || tDeadlines("unassigned")}`}
                          aria-label={`${deadline.title}, ${deadlineLabel}`}
                        >
                          <span className="size-1.5 -rotate-45 rounded-full bg-current" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {rows.map((row) => {
                const project = effectiveSchedule.projects.find((candidate) => candidate.id === row.projectId)!;
                const isRisk = row.kind === "project" && projectRisk(project, tasksByProject.get(project.id) ?? [], today);
                const scheduled = row.startDate && row.dueDate;
                const left = scheduled ? calendarDistance(range.start, row.startDate!) * dayWidth : 0;
                const width = scheduled ? Math.max(dayWidth, (calendarDistance(row.startDate!, row.dueDate!) + 1) * dayWidth) : 0;
                const isCritical = Boolean(row.task && critical.has(row.id));
                const isConflict = Boolean(row.task && conflicts.has(row.id));
                const overflowSpans =
                  row.kind === "project" && scheduled
                    ? [
                        row.overflowStart && row.overflowStart < row.startDate!
                          ? {
                              key: "start",
                              left: calendarDistance(range.start, row.overflowStart) * dayWidth,
                              width: calendarDistance(row.overflowStart, row.startDate!) * dayWidth,
                            }
                          : null,
                        row.overflowEnd && row.overflowEnd > row.dueDate!
                          ? {
                              key: "end",
                              left: (calendarDistance(range.start, row.dueDate!) + 1) * dayWidth,
                              width: calendarDistance(row.dueDate!, row.overflowEnd) * dayWidth,
                            }
                          : null,
                      ].filter((span): span is { key: string; left: number; width: number } => Boolean(span))
                    : [];
                const manager = row.kind === "project"
                  ? schedule.members.find((member) => member.id === project.managerId)?.name
                  : null;
                const isDependencySource = Boolean(
                  row.task && dependencySourceId === row.task.id,
                );
                const isDependencyTarget = Boolean(
                  row.task && validDependencyTarget(row.task.id),
                );
                const dependencyTargetHandle = isDependencyTarget ? (
                  <span
                    className="pointer-events-none absolute top-1/2 -left-1 z-20 size-2.5 -translate-y-1/2 rounded-full border-2 border-indigo-600 bg-card shadow-sm"
                    aria-hidden
                  />
                ) : null;
                const endpointConnector = row.task ? (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={t("dependencyConnector", { name: row.label })}
                    title={t("dependencyConnectorHint")}
                    className={cn(
                      "absolute top-1/2 -right-1.5 z-30 size-3 -translate-y-1/2 rounded-full border-2 bg-card shadow-sm transition-[transform,opacity] duration-150 hover:scale-125 focus-visible:outline-2 focus-visible:outline-ring",
                      isDependencySource
                        ? "border-amber-600 opacity-100"
                        : "border-indigo-600 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                    )}
                    onPointerDown={(event) => startConnectorGesture(event, row.task!)}
                    onPointerMove={moveConnectorGesture}
                    onPointerUp={endConnectorGesture}
                    onPointerCancel={endConnectorGesture}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      event.stopPropagation();
                      setDependencySourceId((current) =>
                        current === row.task!.id ? null : row.task!.id,
                      );
                    }}
                  />
                ) : null;
                return (
                  <div
                    key={row.id}
                    data-row-kind={row.kind}
                    data-task-id={row.task?.id}
                    data-project-id={
                      row.kind === "project" ? row.projectId : undefined
                    }
                    role="treeitem"
                    aria-level={
                      row.kind === "project"
                        ? 1
                        : (row.depth ?? 0) + (focusedTask ? 1 : 2)
                    }
                    aria-expanded={
                      row.kind === "project"
                        ? expandedProjects.has(row.projectId)
                        : row.isSummary
                          ? expandedTasks.has(row.id)
                          : undefined
                    }
                    aria-current={
                      selectedTaskId === row.task?.id ? "true" : undefined
                    }
                    aria-selected={selectedTaskId === row.task?.id}
                    className={cn(
                      "group/row relative z-[2] flex border-b last:border-b-0",
                      row.kind === "project" && "bg-muted/20",
                    )}
                    style={{ width: totalWidth, height: ROW_HEIGHT }}
                  >
                    <div
                      className={cn(
                        "sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r bg-card px-2.5",
                        row.kind === "project" && "bg-muted/55 font-semibold",
                        row.isSummary && row.kind !== "project" && "font-medium",
                        row.kind === "subtask" && "bg-muted/10",
                        selectedTaskId === row.task?.id &&
                          "bg-indigo-50/90 dark:bg-indigo-950/30",
                      )}
                      style={{
                        width: treeWidth,
                        paddingLeft:
                          row.kind === "project"
                            ? 10
                            : 36 + Math.min(row.depth ?? 0, 10) * 18,
                        backgroundImage:
                          row.task && (row.depth ?? 0) > 0
                            ? `repeating-linear-gradient(to right, transparent 0, transparent 16px, color-mix(in oklab, var(--border) 45%, transparent) 16px, color-mix(in oklab, var(--border) 45%, transparent) 17px, transparent 17px, transparent 18px)`
                            : undefined,
                        backgroundSize:
                          row.task && (row.depth ?? 0) > 0
                            ? `${Math.min(row.depth ?? 0, 10) * 18}px 100%`
                            : undefined,
                      }}
                    >
                      {row.kind === "project" && <Button variant="ghost" size="icon-xs" onClick={() => toggle(setExpandedProjects, row.projectId)} aria-label={t("toggleProject")}>{expandedProjects.has(row.projectId) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button>}
                      {row.task && row.isSummary && <Button variant="ghost" size="icon-xs" onClick={() => toggle(setExpandedTasks, row.id)} aria-label={t("toggleSubtasks")}>{expandedTasks.has(row.id) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button>}
                      {(row.kind === "task" || row.kind === "subtask") && !row.isSummary && (row.isMilestone ? <Diamond className="size-3.5 fill-indigo-500 text-indigo-600" /> : <CircleDot className="size-3.5 text-muted-foreground" />)}
                      <button
                        type="button"
                        onClick={() => row.task ? openTask(row.task) : undefined}
                        onFocus={() => row.task && setSelectedTaskId(row.task.id)}
                        onKeyDown={(event) => row.task && handleTaskScheduleKey(event, row)}
                        className={cn(
                          "min-w-0 flex-1 truncate rounded-sm text-left text-sm focus-visible:outline-2 focus-visible:outline-ring",
                          row.task && "hover:underline",
                        )}
                        title={row.label}
                      >
                        {row.label}
                      </button>
                      {isRisk && <AlertTriangle className="size-3.5 text-amber-600" aria-label={t("atRisk")} />}
                      {isConflict && <GitBranch className="size-3.5 text-red-600" aria-label={t("dependencyConflict")} />}
                      <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{row.progress}%</span>
                      {row.kind === "project" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="opacity-30 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none"
                                aria-label={t("projectActions", { name: row.label })}
                              >
                                <Ellipsis className="size-3.5" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => newTask(row.projectId)}>
                              <Plus className="size-3.5" />{t("newTask")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                try {
                                  const result = await fitProjectToTasks(row.projectId);
                                  router.refresh();
                                  offerScheduleUndo(result.changeSetId);
                                } catch {
                                  toast.error(tCommon("error"));
                                }
                              }}
                            >
                              <Minimize2 className="size-3.5" />{t("fitToTasks")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => router.push(`/projects/${row.projectId}`)}
                            >
                              <FolderKanban className="size-3.5" />{t("openBoard")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {row.task && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="opacity-30 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none"
                                aria-label={t("taskActions", { name: row.label })}
                              >
                                <Ellipsis className="size-3.5" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => row.task && openTask(row.task)}>
                              <PanelRightClose className="size-3.5" />{t("openDetails")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => row.task && enterTaskFocus(row.task)}>
                              <Focus className="size-3.5" />{t("focusTask")}
                              <DropdownMenuShortcut>F</DropdownMenuShortcut>
                            </DropdownMenuItem>
                            {!row.isMilestone && (
                              <DropdownMenuItem onClick={() => row.task && newTask(row.projectId, row.task.id)}>
                                <Plus className="size-3.5" />{t("newSubtask")}
                              </DropdownMenuItem>
                            )}
                            {row.isSummary && (
                              <DropdownMenuItem
                                onClick={async () => {
                                  if (!row.task) return;
                                  try {
                                    const result = await fitTaskToChildren(row.task.id);
                                    router.refresh();
                                    offerScheduleUndo(result.changeSetId);
                                  } catch {
                                    toast.error(tCommon("error"));
                                  }
                                }}
                              >
                                <Minimize2 className="size-3.5" />{t("fitToChildren")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={!row.task.parentTaskId}
                              onClick={() => row.task && outdentRow(row.task)}
                            >
                              <IndentDecrease className="size-3.5" />{t("outdentTask")}
                              <DropdownMenuShortcut>Alt+←</DropdownMenuShortcut>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!indentTarget(tasksByProject.get(row.projectId) ?? [], row.task.id)}
                              onClick={() => row.task && indentRow(row.task)}
                            >
                              <IndentIncrease className="size-3.5" />{t("indentTask")}
                              <DropdownMenuShortcut>Alt+→</DropdownMenuShortcut>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => row.task && requestDeleteTask(row.task)}
                            >
                              <Trash2 className="size-3.5" />{tCommon("delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <div
                      className="relative h-full"
                      onClick={(event) => {
                        if (
                          dependencySourceId &&
                          event.target === event.currentTarget
                        ) {
                          setDependencySourceId(null);
                          setDependencyHoverId(null);
                        }
                      }}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      style={{ width: timelineWidth, backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${dayWidth - 1}px, color-mix(in oklab, var(--border) 22%, transparent) ${dayWidth - 1}px, color-mix(in oklab, var(--border) 22%, transparent) ${dayWidth}px)` }}
                    >
                      {!scheduled && row.kind === "project" && row.placement && (
                        <button
                          type="button"
                          className="group absolute top-2 h-7 cursor-grab overflow-hidden rounded-md border border-dashed border-slate-500 bg-slate-100/80 text-left shadow-xs active:cursor-grabbing dark:bg-slate-900/70"
                          style={{
                            left: calendarDistance(range.start, row.placement.startDate) * dayWidth,
                            width: Math.max(
                              120,
                              (calendarDistance(row.placement.startDate, row.placement.dueDate) + 1) * dayWidth,
                            ),
                          }}
                          onPointerDown={(event) => startProjectPlacement(event, project, row)}
                          onPointerMove={moveProjectDrag}
                          onPointerUp={endProjectDrag}
                          onPointerCancel={endProjectDrag}
                          title={t("dragProjectPreset")}
                          aria-label={`${row.label}, ${t("dragProjectPreset")}`}
                        >
                          <span className="block truncate px-2 text-[10px] font-medium leading-6 text-muted-foreground">
                            {t("projectTimelinePreset")}
                          </span>
                        </button>
                      )}
                      {!scheduled && row.task && (
                        <button
                          type="button"
                          onClick={() => openTaskFromBar(row.task)}
                          onPointerDown={(event) => {
                            if (row.task && !dependencySourceId) startUnscheduledDrag(event, row.task);
                          }}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onPointerEnter={() => isDependencyTarget && setDependencyHoverId(row.task!.id)}
                          onPointerLeave={() => setDependencyHoverId((current) => current === row.task?.id ? null : current)}
                          onKeyDown={(event) => handleTaskScheduleKey(event, row)}
                          onFocus={() => row.task && setSelectedTaskId(row.task.id)}
                          aria-current={selectedTaskId === row.task.id ? "true" : undefined}
                          className={cn(
                            "group absolute top-2 h-7 cursor-grab overflow-visible rounded-md border border-dashed border-indigo-400 bg-indigo-50/80 text-left shadow-xs active:cursor-grabbing dark:bg-indigo-950/30",
                            isDependencyTarget && "ring-2 ring-indigo-400/70",
                            selectedTaskId === row.task.id && "outline-2 outline-offset-1 outline-indigo-600",
                          )}
                          style={{
                            left: row.placement
                              ? calendarDistance(range.start, row.placement.startDate) * dayWidth
                              : 8,
                            width: row.placement
                              ? Math.max(
                                  dayWidth,
                                  (calendarDistance(row.placement.startDate, row.placement.dueDate) + 1) * dayWidth,
                                )
                              : 96,
                          }}
                          title={t("dragToSchedule")}
                          aria-label={`${row.label}, ${t("unscheduled")}`}
                        >
                          <span className="block truncate px-2 text-[10px] font-medium leading-6 text-indigo-800 dark:text-indigo-200">
                            {row.isSummary
                              ? t("unscheduledSubtasks", { count: row.unscheduledCount ?? 0 })
                              : t("unscheduled")}
                          </span>
                          <span className="absolute inset-y-0 right-0 hidden w-3 items-center justify-center bg-background/70 text-foreground group-hover:flex"><ChevronRight className="size-3" /></span>
                        </button>
                      )}
                      {scheduled && row.isMilestone && !row.isSummary ? (
                        <button
                          type="button"
                          onClick={() => openTaskFromBar(row.task)}
                          onPointerDown={(event) => {
                            if (row.task && !dependencySourceId) startDrag(event, row.task, "move");
                          }}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onPointerEnter={() => isDependencyTarget && setDependencyHoverId(row.task!.id)}
                          onPointerLeave={() => setDependencyHoverId((current) => current === row.task?.id ? null : current)}
                          onKeyDown={(event) => handleTaskScheduleKey(event, row)}
                          onFocus={() => row.task && setSelectedTaskId(row.task.id)}
                          className={cn(
                            "group absolute top-2 h-7 cursor-grab overflow-visible rounded-md focus-visible:ring-2 focus-visible:ring-ring",
                            isCritical && criticalVisible && "ring-2 ring-red-500",
                            isDependencyTarget && "ring-2 ring-indigo-400/70",
                            selectedTaskId === row.task?.id && "outline-2 outline-offset-1 outline-indigo-600",
                          )}
                          style={{ left, width: Math.max(dayWidth, 24) }}
                          aria-current={selectedTaskId === row.task?.id ? "true" : undefined}
                          aria-label={`${row.label}, ${row.startDate}`}
                        >
                          <span className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-indigo-700 bg-indigo-500 shadow-sm" />
                          {dependencyTargetHandle}
                          {endpointConnector}
                        </button>
                      ) : scheduled && row.isSummary ? (
                        <button
                          type="button"
                          onClick={() => openTaskFromBar(row.task)}
                          onPointerDown={(event) => {
                            if (row.task && !dependencySourceId) startDrag(event, row.task, "move");
                          }}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onPointerEnter={() => isDependencyTarget && setDependencyHoverId(row.task!.id)}
                          onPointerLeave={() => setDependencyHoverId((current) => current === row.task?.id ? null : current)}
                          onKeyDown={(event) => handleTaskScheduleKey(event, row)}
                          onFocus={() => row.task && setSelectedTaskId(row.task.id)}
                          data-summary-bracket="true"
                          className={cn(
                            "group absolute top-[13px] h-[18px] cursor-grab overflow-visible rounded-[4px] focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing",
                            isCritical && criticalVisible && "ring-2 ring-red-500",
                            isDependencyTarget && "ring-2 ring-indigo-400/70",
                            selectedTaskId === row.task?.id && "outline-2 outline-offset-1 outline-indigo-600",
                          )}
                          style={{ left, width }}
                          aria-label={`${row.label}, ${row.startDate} - ${row.dueDate}`}
                          aria-current={selectedTaskId === row.task?.id ? "true" : undefined}
                          title={row.label}
                        >
                          <span className="pointer-events-none absolute inset-0 rounded-[4px] border border-indigo-500/75 bg-indigo-100/85 shadow-xs dark:bg-indigo-950/65" />
                          <span
                            className="pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[3px] bg-indigo-500/35"
                            style={{ width: `${row.progress}%` }}
                          />
                          <span className="pointer-events-none absolute top-[calc(100%-1px)] left-0 h-1.5 w-0.5 bg-indigo-700 dark:bg-indigo-300" />
                          <span className="pointer-events-none absolute top-[calc(100%-1px)] right-0 h-1.5 w-0.5 bg-indigo-700 dark:bg-indigo-300" />
                          <span
                            className="absolute inset-y-0 left-0 z-10 flex w-4 cursor-ew-resize items-center justify-center bg-background/75 text-foreground opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100"
                            title={t("dragStart")}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              if (row.task) startDrag(event, row.task, "start");
                            }}
                          >
                            <ChevronLeft className="size-3" />
                          </span>
                          {dependencyTargetHandle}
                          {endpointConnector}
                          {width > 72 && <span className="pointer-events-none relative z-[1] block truncate px-2 text-left text-[10px] font-semibold leading-[17px] text-indigo-950 dark:text-indigo-100">{row.label}</span>}
                        </button>
                      ) : scheduled && (
                        <button
                          type="button"
                          onClick={() => openTaskFromBar(row.task)}
                          onPointerDown={(event) => {
                            if (row.task) {
                              if (!dependencySourceId) startDrag(event, row.task, "move");
                            } else {
                              startProjectDrag(event, project, row, "move");
                            }
                          }}
                          onPointerMove={(event) => {
                            if (row.task) moveDrag(event);
                            else moveProjectDrag(event);
                          }}
                          onPointerUp={(event) => {
                            if (row.task) endDrag(event);
                            else endProjectDrag(event);
                          }}
                          onPointerEnter={() => isDependencyTarget && setDependencyHoverId(row.task!.id)}
                          onPointerLeave={() => setDependencyHoverId((current) => current === row.task?.id ? null : current)}
                          onKeyDown={(event) => handleTaskScheduleKey(event, row)}
                          onFocus={() => row.task && setSelectedTaskId(row.task.id)}
                          className={cn(
                            "group absolute overflow-visible border transition-shadow motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-ring",
                            "cursor-grab active:cursor-grabbing",
                            row.kind === "project"
                              ? "top-[15px] h-3.5 rounded-[3px] shadow-none"
                              : "top-2 h-7 rounded-md shadow-xs",
                            isCritical && criticalVisible && "ring-2 ring-red-500",
                            isDependencyTarget && "ring-2 ring-indigo-400/70",
                            selectedTaskId === row.task?.id && "outline-2 outline-offset-1 outline-indigo-600",
                          )}
                          style={{
                            left,
                            width,
                            borderColor:
                              row.kind === "project" ? row.color : "#6366f1",
                            backgroundColor:
                              row.kind === "project"
                                ? `color-mix(in oklab, ${row.color} 18%, var(--card))`
                                : "color-mix(in oklab, #4f46e5 18%, var(--card))",
                          }}
                          title={manager ? t("projectManagerTooltip", { name: manager }) : undefined}
                          aria-current={selectedTaskId === row.task?.id ? "true" : undefined}
                          aria-label={`${row.label}, ${row.startDate} – ${row.dueDate}`}
                        >
                          <span
                            className="absolute inset-y-0 left-0 opacity-75"
                            style={{
                              width: `${row.progress}%`,
                              backgroundColor:
                                row.kind === "project" ? row.color : "#4f46e5",
                            }}
                          />
                          {!row.isMilestone && <>
                            <span className="absolute inset-y-0 left-0 z-10 flex w-4 cursor-ew-resize items-center justify-center bg-background/75 text-foreground opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100" title={t("dragStart")} onPointerDown={(event) => { event.stopPropagation(); if (row.task) startDrag(event, row.task, "start"); else startProjectDrag(event, project, row, "start"); }}><ChevronLeft className="size-3" /></span>
                            {row.task ? endpointConnector : (
                              <span className="absolute inset-y-0 right-0 z-10 flex w-4 cursor-ew-resize items-center justify-center bg-background/75 text-foreground opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100" title={t("dragEnd")} onPointerDown={(event) => { event.stopPropagation(); startProjectDrag(event, project, row, "end"); }}><ChevronRight className="size-3" /></span>
                            )}
                          </>}
                          {dependencyTargetHandle}
                          {width > 72 && <span className={cn(
                            "relative z-[1] block truncate px-2 text-left text-[10px]",
                            row.kind === "project"
                              ? "font-semibold leading-[12px]"
                              : "font-medium leading-6",
                          )}>{row.label}</span>}
                          {manager && <span className="pointer-events-none absolute right-5 top-1/2 z-[2] max-w-40 -translate-y-1/2 truncate rounded-sm bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground opacity-0 shadow-sm transition-opacity motion-reduce:transition-none group-hover:opacity-100">{manager}</span>}
                        </button>
                      )}
                      {/* Work reaching past the project's authored window (R4). The
                          bar itself never stretches to swallow it. */}
                      {overflowSpans.map((span) => (
                        <span
                          key={span.key}
                          data-project-overflow={span.key}
                          className="pointer-events-none absolute top-[15px] h-3.5 rounded-[3px] border border-dashed border-amber-500/80"
                          style={{
                            left: span.left,
                            width: Math.max(2, span.width),
                            backgroundImage:
                              "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-amber-500) 24%, transparent) 0 4px, transparent 4px 8px)",
                          }}
                          aria-hidden
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {rows.length === 0 && <div className="sticky left-0 flex h-52 w-[min(100vw,50rem)] items-center justify-center text-sm text-muted-foreground">{t("noScheduleResults")}</div>}
            </div>
          </div>
          </div>
          <ScheduleInspector
            open={inspectorOpen}
            onOpenChange={setInspectorOpen}
            presentation={
              desktopInspector
                ? "dock"
                : compactInspector
                  ? "sheet-bottom"
                  : "sheet-right"
            }
            dockWidth={inspectorWidth}
            onDockResizePointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              inspectorResizeRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                width: inspectorWidth,
              };
            }}
            onDockResizeKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const next = Math.min(
                520,
                Math.max(
                  320,
                  inspectorWidth + (event.key === "ArrowLeft" ? 16 : -16),
                ),
              );
              setInspectorWidth(next);
              window.localStorage.setItem("projects.inspectorWidth", String(next));
            }}
            schedule={schedule}
            task={selectedTask}
            defaultProjectId={newTaskContext?.projectId ?? null}
            defaultParentTaskId={newTaskContext?.parentTaskId ?? null}
            onAddSubtask={(parent) => newTask(parent.projectId, parent.id)}
            onOpenTask={openTask}
            onFocusTask={enterTaskFocus}
            isTaskFocused={Boolean(selectedTask && selectedTask.id === focusedTaskId)}
            onTaskSaved={(taskId, parentTaskId) => {
              if (parentTaskId) {
                const ancestors = taskAncestors(schedule.tasks, parentTaskId);
                setExpandedTasks((current) => {
                  const next = new Set(current);
                  next.add(parentTaskId);
                  ancestors.forEach((ancestor) => next.add(ancestor.id));
                  return next;
                });
              }
              setRevealTaskId(taskId);
            }}
          />
        </div>
      )}

      <NewProjectDialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen} members={schedule.members} />
      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("deleteTaskTitle")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pendingDelete && pendingDelete.descendantCount > 0
              ? t("deleteTaskWithSubtasks", {
                  title: pendingDelete.task.title,
                  count: pendingDelete.descendantCount,
                })
              : t("deleteTaskConfirm", { title: pendingDelete?.task.title ?? "" })}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>{tCommon("cancel")}</Button>
            {pendingDelete && pendingDelete.descendantCount > 0 && (
              <Button variant="outline" onClick={outdentChildrenThenDelete}>{t("outdentChildrenInstead")}</Button>
            )}
            <Button variant="destructive" onClick={confirmDeleteTask}>{tCommon("delete")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
