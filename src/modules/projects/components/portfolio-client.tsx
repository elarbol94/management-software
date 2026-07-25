"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Diamond,
  FolderKanban,
  GitBranch,
  IndentDecrease,
  IndentIncrease,
  LocateFixed,
  Minimize2,
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
  previewPortfolioScheduleChange,
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
  addWorkdays,
  containerOverflow,
  criticalPathTaskIds,
  dependencyConflicts,
  indentTarget,
  leafTasks,
  outdentTarget,
  suggestTaskPlacement,
  taskAncestors,
  taskDescendants,
  weightedProgress,
  workdayDistance,
} from "@/modules/projects/schedule";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
type PreviewChange = {
  entityType: "task" | "project";
  entityId: string;
  title: string;
  beforeStartDate: string | null;
  beforeDueDate: string | null;
  afterStartDate: string | null;
  afterDueDate: string | null;
};

const LEFT_WIDTH = 352;
const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 54;
const DAY_MS = 86_400_000;
const ZOOM_WIDTH: Record<Zoom, number> = {
  week: 32,
  month: 16,
  quarter: 7,
};
const MIN_DAY_WIDTH = 6;
const MAX_DAY_WIDTH = 44;
const ZOOM_WHEEL_SENSITIVITY = 0.003;

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
  schedule,
  task,
  defaultProjectId,
  defaultParentTaskId,
  onAddSubtask,
  onOpenTask,
  onTaskSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: PortfolioSchedule;
  task: PortfolioTask | null;
  defaultProjectId: string | null;
  defaultParentTaskId: string | null;
  onAddSubtask: (task: PortfolioTask) => void;
  onOpenTask: (task: PortfolioTask) => void;
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
  const [lagWorkdays, setLagWorkdays] = useState(0);
  const [pending, setPending] = useState(false);

  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open
    ? `${task?.id ?? "new"}-${defaultProjectId ?? ""}-${defaultParentTaskId ?? ""}`
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
      setLagWorkdays(0);
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
        lagWorkdays,
      });
      setPredecessorId("none");
      setLagWorkdays(0);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error && error.message.includes("cycle") ? t("dependencyCycle") : tCommon("error"));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(34rem,96vw)] overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {task ? t("editTask") : parentTaskId ? t("newSubtask") : t("newTask")}
          </SheetTitle>
          <SheetDescription>{t("scheduleInspectorDescription")}</SheetDescription>
        </SheetHeader>
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
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">{t("unassigned")}</SelectItem>
                  {schedule.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("priority")}</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as typeof priority)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
              <Input id="schedule-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={isSummary} />
            </div>
            {!isMilestone && (
              <div className="grid gap-2">
                <Label htmlFor="schedule-due">{t("dueDate")}</Label>
                <Input id="schedule-due" type="date" value={dueDate} min={startDate || undefined} onChange={(event) => setDueDate(event.target.value)} disabled={isSummary} />
              </div>
            )}
          </div>
          {!isSummary && (
            <div className="grid gap-3 rounded-md border bg-muted/25 p-3">
              <div className="grid gap-2">
                <Label>{t("constraintType")}</Label>
                <Select value={constraintType} onValueChange={(value) => setConstraintType((value ?? "asap") as typeof constraintType)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
                  <div key={dependency.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <GitBranch className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{predecessor?.title}</span>
                    <span className="font-mono text-xs text-muted-foreground">{dependency.lagWorkdays >= 0 ? "+" : ""}{dependency.lagWorkdays}d</span>
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={tCommon("delete")} onClick={async () => {
                      await deleteTaskDependency(dependency.id);
                      router.refresh();
                    }}><Trash2 className="size-3.5" /></Button>
                  </div>
                );
              })}
              <div className="grid grid-cols-[1fr_5.5rem_auto] gap-2">
                <Select value={predecessorId} onValueChange={(value) => setPredecessorId(value ?? "none")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("choosePredecessor")}</SelectItem>
                    {linkableTasks.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>{candidate.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" min={-365} max={365} value={lagWorkdays} onChange={(event) => setLagWorkdays(Number(event.target.value))} aria-label={t("lagWorkdays")} />
                <Button type="button" variant="outline" size="icon" onClick={addDependency} disabled={predecessorId === "none"} aria-label={t("addDependency")}><Plus className="size-4" /></Button>
              </div>
            </div>
          )}
          <Button type="submit" disabled={pending || !title.trim() || !columnId}>
            {tCommon("save")}
          </Button>
        </form>
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
            <div className="grid gap-2"><Label>{t("manager")}</Label><Select value={managerId} onValueChange={(value) => setManagerId(value ?? "none")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("unassigned")}</SelectItem>{members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent></Select></div>
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
}: {
  schedule: PortfolioSchedule;
  projects: ProjectCard[];
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [view, setView] = useState<"timeline" | "projects">("timeline");
  const [zoom, setZoom] = useState<Zoom>("month");
  const [dayWidth, setDayWidth] = useState(ZOOM_WIDTH.month);
  const [treeWidth, setTreeWidth] = useState(LEFT_WIDTH);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [health, setHealth] = useState<"all" | "risk" | "track">("all");
  const [criticalVisible, setCriticalVisible] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState(() => new Set(schedule.projects.map((project) => project.id)));
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(() => new Set());
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<PortfolioTask | null>(null);
  const [newTaskContext, setNewTaskContext] = useState<{
    projectId: string;
    parentTaskId: string | null;
  } | null>(null);
  // Rows the in-flight drag would move besides the one under the pointer. Shown
  // as ghost outlines so the ripple is visible before the drop (R8).
  const [cascade, setCascade] = useState<PreviewChange[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{
    task: PortfolioTask;
    descendantCount: number;
  } | null>(null);
  const [revealTaskId, setRevealTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    taskId: string;
    startDate: string;
    dueDate: string;
    mode: "move" | "resize-start" | "resize-end" | "place";
  } | null>(null);
  const [projectDraft, setProjectDraft] = useState<{
    projectId: string;
    startDate: string;
    dueDate: string;
    mode: "move" | "resize-start" | "resize-end" | "place";
  } | null>(null);
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
  // A bar is both draggable and clickable, and the browser fires click after
  // pointerup either way. Once the pointer has travelled past the threshold the
  // gesture was a drag, so the click that follows must not open the inspector.
  const draggedRef = useRef(false);
  const cascadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cascadeSeqRef = useRef(0);

  useEffect(
    () => () => {
      if (cascadeTimerRef.current) clearTimeout(cascadeTimerRef.current);
    },
    [],
  );

  // Summaries take part in dependencies now (R6), so conflicts and the critical
  // path are computed over the whole tree rather than just its leaves.
  const conflicts = useMemo(
    () => dependencyConflicts(schedule.tasks, schedule.dependencies),
    [schedule],
  );
  const critical = useMemo(
    () => criticalPathTaskIds(schedule.tasks, schedule.dependencies),
    [schedule],
  );
  const cascadeIds = useMemo(
    () => new Set(cascade.map((change) => `${change.entityType}:${change.entityId}`)),
    [cascade],
  );
  const tasksByProject = useMemo(() => {
    const map = new Map<string, PortfolioTask[]>();
    for (const task of schedule.tasks) {
      const list = map.get(task.projectId) ?? [];
      list.push(task);
      map.set(task.projectId, list);
    }
    return map;
  }, [schedule.tasks]);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return schedule.projects.filter((project) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const matchesQuery =
        !needle ||
        project.name.toLocaleLowerCase().includes(needle) ||
        projectTasks.some((task) => task.title.toLocaleLowerCase().includes(needle));
      const matchesOwner =
        owner === "all" ||
        project.managerId === owner ||
        projectTasks.some((task) => task.assigneeId === owner);
      const risk = projectRisk(project, projectTasks, today);
      const matchesHealth = health === "all" || (health === "risk" ? risk : !risk);
      return matchesQuery && matchesOwner && matchesHealth;
    });
  }, [schedule.projects, tasksByProject, query, owner, health, today]);

  const rows = useMemo(() => {
    const result: Row[] = [];
    for (const project of visibleProjects) {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const projectLeaves = leafTasks(projectTasks);
      const projectDates = project.id === projectDraft?.projectId ? projectDraft : null;
      const projectBaseStart = minDate([
        project.plannedStartDate,
        ...projectTasks.map((task) => task.startDate),
      ]);
      const projectOffset =
        projectDraft?.projectId === project.id && projectDraft.mode === "move" && projectBaseStart
          ? workdayDistance(projectBaseStart, projectDraft.startDate)
          : 0;
      // A project bar shows the window that was authored for it, not the span of
      // its work — so work reaching past it is drawn as overflow instead (R3/R4).
      const projectStart = projectDates?.startDate ?? project.plannedStartDate;
      const projectDue = projectDates?.dueDate ?? project.targetEndDate;
      const overflow = containerOverflow(
        { startDate: projectStart, dueDate: projectDue },
        projectTasks.map((task) => ({
          startDate: projectOffset && task.startDate ? addWorkdays(task.startDate, projectOffset) : task.startDate,
          dueDate: projectOffset && task.dueDate ? addWorkdays(task.dueDate, projectOffset) : task.dueDate,
        })),
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
          workdays: 20,
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
        const draftTask = draft
          ? projectTasks.find((candidate) => candidate.id === draft.taskId)
          : null;
        const taskDraftOffset =
          draft?.mode === "move" && draftTask?.startDate
            ? workdayDistance(draftTask.startDate, draft.startDate)
            : 0;
        const draftDescendantIds = new Set(
          draftTask ? taskDescendants(projectTasks, draftTask.id).map((child) => child.id) : [],
        );
        const renderDraftTask = (candidate: PortfolioTask) => {
          if (candidate.id === draft?.taskId) {
            return {
              ...candidate,
              startDate: projectOffset ? addWorkdays(draft.startDate, projectOffset) : draft.startDate,
              dueDate: projectOffset ? addWorkdays(draft.dueDate, projectOffset) : draft.dueDate,
            };
          }
          const offset = taskDraftOffset + projectOffset;
          if (offset && (draftDescendantIds.has(candidate.id) || projectOffset !== 0) && candidate.startDate && candidate.dueDate) {
            return {
              ...candidate,
              startDate: addWorkdays(candidate.startDate, offset),
              dueDate: addWorkdays(candidate.dueDate, offset),
            };
          }
          return candidate;
        };
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
            workdays: task.isMilestone ? 1 : 5,
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
  }, [visibleProjects, tasksByProject, expandedProjects, expandedTasks, draft, projectDraft, today]);

  const range = useMemo(() => {
    const scheduled = rows.flatMap((row) => [row.startDate, row.dueDate]).filter((value): value is string => Boolean(value));
    const earliest = minDate(scheduled) ?? today;
    const latest = maxDate(scheduled) ?? today;
    return {
      start: addCalendarDays(earliest < addCalendarDays(today, -14) ? earliest : addCalendarDays(today, -14), -7),
      end: addCalendarDays(latest > addCalendarDays(today, 90) ? latest : addCalendarDays(today, 90), 14),
    };
  }, [rows, today]);
  const dayCount = calendarDistance(range.start, range.end) + 1;
  const timelineWidth = dayCount * dayWidth;
  const totalWidth = treeWidth + timelineWidth;
  const totalHeight = HEADER_HEIGHT + rows.length * ROW_HEIGHT;

  useEffect(() => {
    if (!revealTaskId) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(
      `[data-task-id="${revealTaskId}"]`,
    );
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    setRevealTaskId(null);
  }, [revealTaskId, rows]);

  const nextMilestone = schedule.tasks
    .filter((task) => task.isMilestone && task.dueDate && task.dueDate >= today && task.progress < 100)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))[0];
  const riskCount = schedule.projects.filter((project) =>
    projectRisk(project, tasksByProject.get(project.id) ?? [], today),
  ).length;

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTask(task: PortfolioTask) {
    setSelectedTask(task);
    setNewTaskContext(null);
    setInspectorOpen(true);
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
    setSelectedTask(null);
    setNewTaskContext({ projectId, parentTaskId });
    setInspectorOpen(true);
  }

  type ScheduleEdit = {
    entityType: "task" | "project";
    entityId: string;
    startDate: string;
    dueDate: string;
    operation: "move" | "resize-start" | "resize-end" | "place";
  };

  /**
   * Asks the server what else the in-flight drag would move, so those rows can
   * be ghosted while the pointer is still down. Debounced, and stale replies are
   * dropped — the cascade is decoration, never the source of what gets saved.
   */
  function previewCascade(input: ScheduleEdit) {
    if (cascadeTimerRef.current) clearTimeout(cascadeTimerRef.current);
    cascadeTimerRef.current = setTimeout(() => {
      const seq = (cascadeSeqRef.current += 1);
      void previewPortfolioScheduleChange(input)
        .then((changes) => {
          if (seq !== cascadeSeqRef.current) return;
          setCascade(
            changes.filter(
              (change) =>
                !(change.entityType === input.entityType && change.entityId === input.entityId),
            ),
          );
        })
        .catch(() => {
          if (seq === cascadeSeqRef.current) setCascade([]);
        });
    }, 90);
  }

  const DRAG_CLICK_THRESHOLD = 4;

  /** Marks the gesture a drag once the pointer travels far enough to count. */
  function trackDragMovement(clientX: number, startX: number) {
    if (Math.abs(clientX - startX) > DRAG_CLICK_THRESHOLD) draggedRef.current = true;
  }

  /** Opens the inspector, unless this click is the tail end of a drag. */
  function openTaskFromBar(task: PortfolioTask | undefined) {
    if (draggedRef.current || !task) return;
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
    if (cascadeTimerRef.current) clearTimeout(cascadeTimerRef.current);
    cascadeSeqRef.current += 1;
    setCascade([]);
    setDraft(null);
    setProjectDraft(null);
  }

  /**
   * Commits a drag straight from the drop and offers undo (R8). The server
   * recomputes the cascade itself, so nothing from the live preview is trusted
   * here; a concurrent edit surfaces as a rejected apply rather than silent loss.
   */
  async function commitSchedule(input: ScheduleEdit) {
    try {
      const result = await applyPortfolioScheduleChange(input);
      clearDrag();
      router.refresh();
      if (!result.changeSetId) return;
      toast.success(t("scheduleSaved"), {
        action: {
          label: t("undo"),
          onClick: async () => {
            try {
              await revertPortfolioScheduleChange(result.changeSetId!);
              router.refresh();
              toast.success(t("scheduleRestored"));
            } catch {
              toast.error(t("undoUnavailable"));
            }
          },
        },
      });
    } catch (error) {
      clearDrag();
      router.refresh();
      toast.error(
        error instanceof Error && error.message.includes("another session")
          ? t("scheduleChanged")
          : tCommon("error"),
      );
    }
  }

  function startDrag(event: ReactPointerEvent, task: PortfolioTask, mode: "move" | "start" | "end") {
    if (!task.startDate || !task.dueDate) return;
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
    setDraft({ ...latest, mode: mode === "move" ? "move" : mode === "start" ? "resize-start" : "resize-end" });
  }

  function startUnscheduledDrag(event: ReactPointerEvent, task: PortfolioTask) {
    if (task.startDate || task.dueDate) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    const timelineLeft = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    const suggestion = rows.find((row) => row.task?.id === task.id)?.placement;
    const startDate =
      suggestion?.startDate ??
      addWorkdays(
        addCalendarDays(
          range.start,
          Math.max(0, Math.round((event.clientX - timelineLeft) / dayWidth)),
        ),
        0,
      );
    const dueDate =
      suggestion?.dueDate ?? (task.isMilestone ? startDate : addWorkdays(startDate, 4));
    const latest = { taskId: task.id, startDate, dueDate };
    dragRef.current = {
      pointerId: event.pointerId,
      mode: "place",
      task,
      startX: event.clientX,
      timelineLeft,
      latest,
    };
    setDraft({ ...latest, mode: "place" });
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
      const startDate = addWorkdays(addCalendarDays(range.start, dayOffset), 0);
      drag.latest = {
        taskId: drag.task.id,
        startDate,
        dueDate: drag.task.isMilestone ? startDate : addWorkdays(startDate, 4),
      };
      setDraft({ ...drag.latest, mode: "place" });
      return;
    }
    if (!drag.task.startDate || !drag.task.dueDate) return;
    const delta = Math.round((event.clientX - drag.startX) / dayWidth);
    let startDate = drag.task.startDate;
    let dueDate = drag.task.dueDate;
    if (drag.mode === "move") {
      startDate = addWorkdays(drag.task.startDate, delta);
      dueDate = drag.task.isMilestone ? startDate : addWorkdays(drag.task.dueDate, delta);
    } else if (drag.mode === "start") {
      startDate = addWorkdays(drag.task.startDate, delta);
      if (startDate > dueDate) startDate = dueDate;
    } else {
      dueDate = addWorkdays(drag.task.dueDate, delta);
      if (dueDate < startDate) dueDate = startDate;
    }
    drag.latest = { taskId: drag.task.id, startDate, dueDate };
    setDraft({
      ...drag.latest,
      mode: drag.mode === "move" ? "move" : drag.mode === "start" ? "resize-start" : "resize-end",
    });
    previewCascade(taskScheduleEdit(drag.task.id, drag.mode, drag.latest));
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
    void commitSchedule(taskScheduleEdit(drag.task.id, drag.mode, drag.latest));
  }

  function handleTaskScheduleKey(
    event: React.KeyboardEvent<HTMLButtonElement>,
    row: Row,
  ) {
    if (!row.task) return;
    if (event.key === "Tab") {
      event.preventDefault();
      void (event.shiftKey ? outdentRow(row.task) : indentRow(row.task));
      return;
    }
    if (event.key === "Escape") {
      clearDrag();
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
    const offset = (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 5 : 1);
    setDraft({
      taskId: row.task.id,
      startDate: addWorkdays(baseStart, offset),
      dueDate: addWorkdays(baseDue, offset),
      mode: "move",
    });
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
    if (!row.startDate || !row.dueDate) return;
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
    setProjectDraft({
      projectId: project.id,
      ...original,
      mode: mode === "move" ? "move" : mode === "start" ? "resize-start" : "resize-end",
    });
  }

  function startProjectPlacement(
    event: ReactPointerEvent,
    project: PortfolioSchedule["projects"][number],
    row: Row,
  ) {
    if (!row.placement) return;
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
    setProjectDraft({ projectId: project.id, ...original, mode: "place" });
  }

  function moveProjectDrag(event: ReactPointerEvent) {
    const drag = projectDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    trackDragMovement(event.clientX, drag.startX);
    const delta = Math.round((event.clientX - drag.startX) / dayWidth);
    let startDate = drag.original.startDate;
    let dueDate = drag.original.dueDate;
    if (drag.mode === "move" || drag.mode === "place") {
      startDate = addWorkdays(startDate, delta);
      dueDate = addWorkdays(dueDate, delta);
    } else if (drag.mode === "start") {
      startDate = addWorkdays(startDate, delta);
      if (startDate > dueDate) startDate = dueDate;
    } else {
      dueDate = addWorkdays(dueDate, delta);
      if (dueDate < startDate) dueDate = startDate;
    }
    drag.latest = { startDate, dueDate };
    setProjectDraft({
      projectId: drag.project.id,
      ...drag.latest,
      mode: drag.mode === "move" || drag.mode === "place" ? drag.mode : drag.mode === "start" ? "resize-start" : "resize-end",
    });
    previewCascade(projectScheduleEdit(drag.project.id, drag.mode, drag.latest));
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
    void commitSchedule(projectScheduleEdit(drag.project.id, drag.mode, drag.latest));
  }

  function scrollToToday() {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;
    const todayOffset = calendarDistance(range.start, today) * dayWidth;
    const left = todayOffset - dayWidth * 7;
    scrollContainer.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
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

  return (
    <div className="flex min-w-0 flex-col gap-5">
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

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <div className="flex rounded-md bg-muted p-1">
          <Button size="sm" variant={view === "timeline" ? "secondary" : "ghost"} onClick={() => setView("timeline")}><CalendarClock className="size-4" />{t("timeline")}</Button>
          <Button size="sm" variant={view === "projects" ? "secondary" : "ghost"} onClick={() => setView("projects")}><FolderKanban className="size-4" />{t("projectOverview")}</Button>
        </div>
        {view === "timeline" && (
          <>
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchSchedule")} className="pl-8" />
            </div>
            <Select value={owner} onValueChange={(value) => setOwner(value ?? "all")}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("allOwners")}</SelectItem>{schedule.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent></Select>
            <Select value={health} onValueChange={(value) => setHealth((value ?? "all") as typeof health)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("allHealth")}</SelectItem><SelectItem value="track">{t("onTrack")}</SelectItem><SelectItem value="risk">{t("atRisk")}</SelectItem></SelectContent></Select>
            <div className="ml-auto flex rounded-md border p-0.5">
              {(["week", "month", "quarter"] as const).map((option) => <Button key={option} size="xs" variant={zoom === option ? "secondary" : "ghost"} onClick={() => setTimelineZoom(option)}>{t(option)}</Button>)}
            </div>
            <Button size="sm" variant="outline" onClick={scrollToToday}><LocateFixed className="size-4" />{t("today")}</Button>
            <Button size="sm" variant={criticalVisible ? "secondary" : "outline"} onClick={() => setCriticalVisible((value) => !value)}><GitBranch className="size-4" />{t("criticalPath")}</Button>
          </>
        )}
      </div>

      {view === "projects" ? (
        <ProjectsClient projects={projects} members={schedule.members} />
      ) : (
        <>
          <div className="grid gap-2 md:hidden">
            {rows.filter((row) => row.kind === "task" || row.kind === "subtask").map((row) => (
              <button key={row.id} type="button" onClick={() => row.task && openTask(row.task)} className={cn("grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border bg-card p-3 text-left", row.kind === "subtask" && "ml-5 border-l-2 border-l-violet-400")}>
                {row.isMilestone ? <Diamond className="size-4 fill-violet-500 text-violet-600" /> : <span className="size-2.5 rounded-full" style={{ backgroundColor: row.color }} />}
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{row.label}</span><span className="block text-xs text-muted-foreground">{row.startDate ?? t("unscheduled")}{row.dueDate && !row.isMilestone ? ` – ${row.dueDate}` : ""}</span></span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{row.progress}%</span>
              </button>
            ))}
          </div>

          <div ref={scrollRef} onWheel={handleTimelineWheel} className="hidden max-h-[calc(100dvh-15rem)] overflow-auto rounded-lg border bg-card md:block" data-testid="portfolio-gantt">
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
                </div>
              </div>

              <div className="pointer-events-none absolute z-0" style={{ left: treeWidth, top: HEADER_HEIGHT, width: timelineWidth, height: rows.length * ROW_HEIGHT }}>
                {Array.from({ length: dayCount }, (_, index) => {
                  const date = addCalendarDays(range.start, index);
                  const day = parseDate(date).getUTCDay();
                  return day === 0 || day === 6 ? <span key={date} className="absolute inset-y-0 bg-slate-100/80 dark:bg-slate-900/45" style={{ left: index * dayWidth, width: dayWidth }} /> : null;
                })}
                {today >= range.start && today <= range.end && <span className="absolute inset-y-0 z-10 w-px bg-red-500" style={{ left: calendarDistance(range.start, today) * dayWidth + dayWidth / 2 }} />}
              </div>

              <svg className="pointer-events-none absolute z-[1] overflow-visible" aria-hidden style={{ left: treeWidth, top: HEADER_HEIGHT, width: timelineWidth, height: rows.length * ROW_HEIGHT }}>
                {schedule.dependencies.map((dependency) => {
                  const fromIndex = rowIndex.get(dependency.predecessorTaskId);
                  const toIndex = rowIndex.get(dependency.successorTaskId);
                  const from = taskRows.get(dependency.predecessorTaskId);
                  const to = taskRows.get(dependency.successorTaskId);
                  if (fromIndex === undefined || toIndex === undefined || !from?.dueDate || !to?.startDate) return null;
                  const x1 = (calendarDistance(range.start, from.dueDate) + 1) * dayWidth;
                  const x2 = calendarDistance(range.start, to.startDate) * dayWidth;
                  const y1 = fromIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const y2 = toIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
                  const bend = Math.max(x1 + 12, (x1 + x2) / 2);
                  return <path key={dependency.id} d={`M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`} fill="none" stroke="currentColor" strokeWidth="1.25" className="text-slate-400 dark:text-slate-600" />;
                })}
              </svg>

              {rows.map((row) => {
                const project = schedule.projects.find((candidate) => candidate.id === row.projectId)!;
                const isRisk = row.kind === "project" && projectRisk(project, tasksByProject.get(project.id) ?? [], today);
                const scheduled = row.startDate && row.dueDate;
                const left = scheduled ? calendarDistance(range.start, row.startDate!) * dayWidth : 0;
                const width = scheduled ? Math.max(dayWidth, (calendarDistance(row.startDate!, row.dueDate!) + 1) * dayWidth) : 0;
                const isCritical = Boolean(row.task && critical.has(row.id));
                const isConflict = Boolean(row.task && conflicts.has(row.id));
                // Rows the in-flight drag would drag along with it (R8).
                const isGhosted = cascadeIds.has(
                  `${row.task ? "task" : "project"}:${row.task?.id ?? row.projectId}`,
                );
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
                return (
                  <div
                    key={row.id}
                    data-row-kind={row.kind}
                    data-task-id={row.task?.id}
                    className="relative z-[2] flex border-b last:border-b-0"
                    style={{ width: totalWidth, height: ROW_HEIGHT }}
                  >
                    <div
                      className={cn(
                        "sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r bg-card px-2.5",
                        row.kind === "project" && "bg-muted/45 font-semibold",
                        row.kind === "subtask" && "bg-muted/15",
                      )}
                      style={{
                        width: treeWidth,
                        paddingLeft:
                          row.kind === "project"
                            ? 10
                            : 36 + Math.min(row.depth ?? 0, 10) * 18,
                        backgroundImage:
                          row.task && (row.depth ?? 0) > 0
                            ? `repeating-linear-gradient(to right, transparent 0, transparent 16px, color-mix(in oklab, var(--border) 65%, transparent) 16px, color-mix(in oklab, var(--border) 65%, transparent) 17px, transparent 17px, transparent 18px)`
                            : undefined,
                        backgroundSize:
                          row.task && (row.depth ?? 0) > 0
                            ? `${Math.min(row.depth ?? 0, 10) * 18}px 100%`
                            : undefined,
                      }}
                    >
                      {row.kind === "project" && <Button variant="ghost" size="icon-xs" onClick={() => toggle(setExpandedProjects, row.projectId)} aria-label={t("toggleProject")}>{expandedProjects.has(row.projectId) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button>}
                      {row.task && row.isSummary && <Button variant="ghost" size="icon-xs" onClick={() => toggle(setExpandedTasks, row.id)} aria-label={t("toggleSubtasks")}>{expandedTasks.has(row.id) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button>}
                      {(row.kind === "task" || row.kind === "subtask") && !row.isSummary && (row.isMilestone ? <Diamond className="size-3.5 fill-violet-500 text-violet-600" /> : <CircleDot className="size-3.5 text-muted-foreground" />)}
                      <button type="button" onClick={() => row.task ? openTask(row.task) : undefined} className={cn("min-w-0 flex-1 truncate text-left text-sm", row.task && "hover:underline")}>{row.label}</button>
                      {isRisk && <AlertTriangle className="size-3.5 text-amber-600" aria-label={t("atRisk")} />}
                      {isConflict && <GitBranch className="size-3.5 text-red-600" aria-label={t("dependencyConflict")} />}
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{row.progress}%</span>
                      {row.kind === "project" && <>
                        <Button variant="ghost" size="icon-xs" title={t("newTask")} onClick={() => newTask(row.projectId)}><Plus className="size-3.5" /></Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={t("fitToTasks")}
                          onClick={async () => {
                            try {
                              await fitProjectToTasks(row.projectId);
                              router.refresh();
                              toast.success(t("fitToTasks"));
                            } catch {
                              toast.error(tCommon("error"));
                            }
                          }}
                        >
                          <Minimize2 className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon-xs" nativeButton={false} render={<Link href={`/projects/${row.projectId}`} />} title={t("openBoard")}><FolderKanban className="size-3.5" /></Button>
                      </>}
                      {row.task && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title={t("outdentTask")}
                            disabled={!row.task.parentTaskId}
                            onClick={() => row.task && outdentRow(row.task)}
                          >
                            <IndentDecrease className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title={t("indentTask")}
                            disabled={!indentTarget(tasksByProject.get(row.projectId) ?? [], row.task.id)}
                            onClick={() => row.task && indentRow(row.task)}
                          >
                            <IndentIncrease className="size-3.5" />
                          </Button>
                          {!row.isMilestone && (
                            <Button variant="ghost" size="icon-xs" title={t("newSubtask")} onClick={() => row.task && newTask(row.projectId, row.task.id)}><Plus className="size-3.5" /></Button>
                          )}
                          <Button variant="ghost" size="icon-xs" title={tCommon("delete")} onClick={() => row.task && requestDeleteTask(row.task)}><Trash2 className="size-3.5" /></Button>
                        </>
                      )}
                    </div>
                    <div
                      className="relative h-full"
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      style={{ width: timelineWidth, backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${dayWidth - 1}px, color-mix(in oklab, var(--border) 55%, transparent) ${dayWidth - 1}px, color-mix(in oklab, var(--border) 55%, transparent) ${dayWidth}px)` }}
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
                          onPointerDown={(event) => row.task && startUnscheduledDrag(event, row.task)}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onKeyDown={(event) => handleTaskScheduleKey(event, row)}
                          className="group absolute top-2 h-7 cursor-grab overflow-hidden rounded-md border border-dashed border-violet-400 bg-violet-50/80 text-left shadow-xs active:cursor-grabbing dark:bg-violet-950/30"
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
                          <span className="block truncate px-2 text-[10px] font-medium leading-6 text-violet-800 dark:text-violet-200">
                            {row.isSummary
                              ? t("unscheduledSubtasks", { count: row.unscheduledCount ?? 0 })
                              : t("unscheduled")}
                          </span>
                          <span className="absolute inset-y-0 right-0 hidden w-3 items-center justify-center bg-background/70 text-foreground group-hover:flex"><ChevronRight className="size-3" /></span>
                        </button>
                      )}
                      {scheduled && row.isMilestone && !row.isSummary ? (
                        <button type="button" onClick={() => openTaskFromBar(row.task)} onPointerDown={(event) => row.task && startDrag(event, row.task, "move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={(event) => handleTaskScheduleKey(event, row)} className={cn("absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-violet-700 bg-violet-500 shadow-sm focus-visible:ring-2 focus-visible:ring-ring", isCritical && criticalVisible && "border-red-600 bg-red-500")} style={{ left: left + dayWidth / 2 }} aria-label={`${row.label}, ${row.startDate}`} />
                      ) : scheduled && row.isSummary ? (
                        // A summary spans exactly its subtasks (R1), so it is drawn as
                        // a bracket rather than a bar and carries no resize grips —
                        // there is nothing to resize, only a subtree to move (R9).
                        <button
                          type="button"
                          onClick={() => openTaskFromBar(row.task)}
                          onPointerDown={(event) => row.task && startDrag(event, row.task, "move")}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onKeyDown={(event) => handleTaskScheduleKey(event, row)}
                          data-summary-bracket="true"
                          className={cn(
                            "group absolute top-2.5 h-5 cursor-grab focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing",
                            isGhosted && "opacity-60 outline-2 outline-amber-500",
                          )}
                          style={{ left, width }}
                          aria-label={`${row.label}, ${row.startDate} - ${row.dueDate}`}
                        >
                          <span className="absolute inset-x-0 top-0 h-1.5 rounded-sm" style={{ backgroundColor: row.color }} />
                          <span className="absolute left-0 top-0 h-3 w-1.5" style={{ backgroundColor: row.color }} />
                          <span className="absolute right-0 top-0 h-3 w-1.5" style={{ backgroundColor: row.color }} />
                          <span className="absolute left-0 top-0 h-1.5 rounded-sm bg-foreground/45" style={{ width: `${row.progress}%` }} />
                          {width > 72 && <span className="absolute inset-x-2 top-2 truncate text-left text-[10px] font-medium leading-4 text-muted-foreground">{row.label}</span>}
                        </button>
                      ) : scheduled && (
                        <button type="button" onClick={() => openTaskFromBar(row.task)} onPointerDown={(event) => { if (row.task) startDrag(event, row.task, "move"); else startProjectDrag(event, project, row, "move"); }} onPointerMove={(event) => { if (row.task) moveDrag(event); else moveProjectDrag(event); }} onPointerUp={(event) => { if (row.task) endDrag(event); else endProjectDrag(event); }} onKeyDown={(event) => handleTaskScheduleKey(event, row)} className={cn("group absolute top-2 h-7 overflow-hidden rounded-md border shadow-xs transition-shadow focus-visible:ring-2 focus-visible:ring-ring", "cursor-grab active:cursor-grabbing", row.kind === "project" && "opacity-70", isCritical && criticalVisible && "ring-2 ring-red-500", isGhosted && "ring-2 ring-amber-500")} style={{ left, width, borderColor: row.color, backgroundColor: `color-mix(in oklab, ${row.color} 23%, var(--card))` }} title={manager ? t("projectManagerTooltip", { name: manager }) : undefined} aria-label={`${row.label}, ${row.startDate} – ${row.dueDate}`}>
                          <span className="absolute inset-y-0 left-0 opacity-75" style={{ width: `${row.progress}%`, backgroundColor: row.color }} />
                          {!row.isMilestone && <>
                            <span className="absolute inset-y-0 left-0 z-10 flex w-4 cursor-ew-resize items-center justify-center bg-background/75 text-foreground opacity-0 transition-opacity group-hover:opacity-100" title={t("dragStart")} onPointerDown={(event) => { event.stopPropagation(); if (row.task) startDrag(event, row.task, "start"); else startProjectDrag(event, project, row, "start"); }}><ChevronLeft className="size-3" /></span>
                            <span className="absolute inset-y-0 right-0 z-10 flex w-4 cursor-ew-resize items-center justify-center bg-background/75 text-foreground opacity-0 transition-opacity group-hover:opacity-100" title={t("dragEnd")} onPointerDown={(event) => { event.stopPropagation(); if (row.task) startDrag(event, row.task, "end"); else startProjectDrag(event, project, row, "end"); }}><ChevronRight className="size-3" /></span>
                          </>}
                          {width > 72 && <span className="relative z-[1] block truncate px-2 text-left text-[10px] font-medium leading-6">{row.label}</span>}
                          {manager && <span className="pointer-events-none absolute right-5 top-1/2 z-[2] max-w-40 -translate-y-1/2 truncate rounded-sm bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">{manager}</span>}
                        </button>
                      )}
                      {/* Work reaching past the project's authored window (R4). The
                          bar itself never stretches to swallow it. */}
                      {overflowSpans.map((span) => (
                        <span
                          key={span.key}
                          data-project-overflow={span.key}
                          className="pointer-events-none absolute top-2 h-7 rounded-sm border border-dashed border-amber-500/80"
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
        </>
      )}

      <NewProjectDialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen} members={schedule.members} />
      <ScheduleInspector
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        schedule={schedule}
        task={selectedTask}
        defaultProjectId={newTaskContext?.projectId ?? null}
        defaultParentTaskId={newTaskContext?.parentTaskId ?? null}
        onAddSubtask={(parent) => newTask(parent.projectId, parent.id)}
        onOpenTask={openTask}
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
