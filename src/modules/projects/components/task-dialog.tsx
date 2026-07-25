"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ChevronRight, Loader2, Trash2 } from "lucide-react";
import {
  deleteTask,
  upsertTask,
} from "@/modules/projects/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EvidencePanel } from "@/modules/wiki/components/evidence-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type MemberDto = { id: string; name: string };
export type BoardTaskDto = {
  id: string;
  projectId: string;
  columnId: string;
  parentTaskId: string | null;
  title: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  startDate: string | null;
  progress: number;
  isMilestone: boolean;
  priority: "low" | "medium" | "high";
  sortOrder: number;
};

const UNASSIGNED = "unassigned";

export function TaskDialog({
  open,
  onOpenChange,
  projectId,
  columns,
  members,
  task,
  defaultColumnId,
  defaultParentTaskId,
  parentTask,
  subtasks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  columns: Array<{ id: string; name: string; isCompleted?: boolean }>;
  members: MemberDto[];
  task: BoardTaskDto | null;
  defaultColumnId: string | null;
  defaultParentTaskId: string | null;
  parentTask: BoardTaskDto | null;
  subtasks: BoardTaskDto[];
}) {
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnId, setColumnId] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>(UNASSIGNED);
  const [dueDate, setDueDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [progress, setProgress] = useState(0);
  const [isMilestone, setIsMilestone] = useState(false);
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [pending, setPending] = useState(false);
  const isSummary = subtasks.length > 0;
  const isSubtask = Boolean(task?.parentTaskId ?? defaultParentTaskId);
  const unscheduledSubtasks = subtasks.filter(
    (subtask) => !subtask.startDate || !subtask.dueDate,
  ).length;

  // Reset form state when the dialog opens (render-time state adjustment).
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? `${task?.id ?? "new"}-${defaultColumnId ?? ""}-${defaultParentTaskId ?? ""}` : null;
  if (syncKey !== currentKey) {
    setSyncKey(currentKey);
    if (currentKey !== null) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setColumnId(task?.columnId ?? defaultColumnId ?? columns[0]?.id ?? "");
      setAssigneeId(task?.assigneeId ?? UNASSIGNED);
      setDueDate(task?.dueDate ?? "");
      setStartDate(task?.startDate ?? "");
      setProgress(task?.progress ?? 0);
      setIsMilestone(task?.isMilestone ?? false);
      setPriority(task?.priority ?? "medium");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await upsertTask({
        id: task?.id,
        projectId,
        columnId,
        parentTaskId: task?.parentTaskId ?? defaultParentTaskId,
        title,
        description,
        assigneeId: assigneeId === UNASSIGNED ? null : assigneeId,
        startDate: startDate || null,
        dueDate: isMilestone ? startDate || null : dueDate || null,
        progress,
        isMilestone,
        priority,
      });
      toast.success(tCommon("saved"));
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  async function onDelete() {
    if (!task) return;
    if (!window.confirm(tCommon("confirmDeleteTitle"))) return;
    setPending(true);
    try {
      await deleteTask(task.id);
      onOpenChange(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const priorityLabel = {
    low: t("priorityLow"),
    medium: t("priorityMedium"),
    high: t("priorityHigh"),
  }[priority];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {task ? t("editTask") : isSubtask ? t("newSubtask") : t("newTask")}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {isSubtask && parentTask && (
            <div className="flex items-center gap-1.5 rounded-md border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
              <span>{t("subtaskOf")}</span>
              <ChevronRight className="size-3.5" />
              <span className="truncate font-medium text-foreground">
                {parentTask.title}
              </span>
            </div>
          )}

          {isSummary && (
            <div className="rounded-md border border-violet-200 bg-violet-50/70 px-3 py-2.5 text-xs text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100">
              <p>{t("summaryScheduleDescription")}</p>
              {unscheduledSubtasks > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  {t("unscheduledSubtasks", { count: unscheduledSubtasks })}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-title">{t("taskTitle")}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={300}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="task-description">{t("description")}</Label>
            <Textarea
              id="task-description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>{t("column")}</Label>
              <Select
                value={columnId}
                onValueChange={(value) => setColumnId(value ?? "")}
              >
                <SelectTrigger className="w-full" id="task-column">
                  <SelectValue>
                    {columns.find((c) => c.id === columnId)?.name ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("priority")}</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as typeof priority)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{priorityLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("priorityLow")}</SelectItem>
                  <SelectItem value="medium">{t("priorityMedium")}</SelectItem>
                  <SelectItem value="high">{t("priorityHigh")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("assignee")}</Label>
              <Select
                value={assigneeId}
                onValueChange={(value) => setAssigneeId(value ?? UNASSIGNED)}
              >
                <SelectTrigger className="w-full" id="task-assignee">
                  <SelectValue>
                    {assigneeId === UNASSIGNED
                      ? t("unassigned")
                      : (members.find((m) => m.id === assigneeId)?.name ?? "")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t("unassigned")}</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="task-milestone"
              checked={isMilestone}
              onCheckedChange={(checked) => setIsMilestone(Boolean(checked))}
              disabled={isSummary}
            />
            <Label htmlFor="task-milestone">{t("milestone")}</Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="task-start">
                {isMilestone ? t("milestoneDate") : t("startDate")}
              </Label>
              <Input
                id="task-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isSummary}
              />
            </div>
            {!isMilestone && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="task-due">{t("dueDate")}</Label>
                <Input
                  id="task-due"
                  type="date"
                  min={startDate || undefined}
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={isSummary}
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="task-progress">{t("progress")}</Label>
              <span className="font-mono text-xs text-muted-foreground">
                {progress}%
              </span>
            </div>
            <Input
              id="task-progress"
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              disabled={isSummary}
            />
          </div>

          {isSummary && (
            <div className="flex flex-col gap-2">
              <Label>{t("subtasks")}</Label>
              <div className="divide-y rounded-md border">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{subtask.title}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {subtask.progress}%
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("summaryScheduleDescription")}</p>
            </div>
          )}

          {task && <EvidencePanel targetType="task" targetId={task.id} compact />}

          <div className="flex items-center justify-between gap-2">
            {task ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onDelete}
                disabled={pending}
              >
                <Trash2 className="size-4" />
                {t("deleteTask")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={pending || !columnId}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tCommon("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
