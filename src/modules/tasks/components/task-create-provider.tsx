"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, MapPin, Save } from "lucide-react";
import {
  getContextualTaskOptions,
  upsertContextualTask,
} from "@/modules/projects/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import type {
  EditableTask,
  TaskOrigin,
  TaskPriority,
  TaskStatus,
} from "../types";

type OpenTaskOptions = {
  origin?: TaskOrigin;
  task?: EditableTask;
  initialTitle?: string;
  onCreated?: (taskId: string) => void;
};

type TaskCreatorContextValue = {
  openTaskCreator: (options?: OpenTaskOptions) => void;
};

const TaskCreatorContext = createContext<TaskCreatorContextValue | null>(null);
const NONE = "none";

export function useTaskCreator() {
  const value = useContext(TaskCreatorContext);
  if (!value) throw new Error("useTaskCreator must be used inside TaskCreateProvider");
  return value;
}

function defaultOrigin(pathname: string, search: string): TaskOrigin {
  const sourceMatch = pathname.match(/^\/wiki\/sources\/([^/]+)$/);
  const wikiMatch = pathname.match(/^\/wiki\/pages\/([^/]+)$/);
  return {
    type: sourceMatch ? "wikiSource" : wikiMatch ? "wikiPage" : "app",
    entityId: decodeURIComponent(sourceMatch?.[1] ?? wikiMatch?.[1] ?? pathname),
    route: `${pathname}${search ? `?${search}` : ""}`,
    label: pathname === "/" ? "Dashboard" : pathname,
  };
}

export function TaskCreateProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("tasks");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getContextualTaskOptions>> | null>(null);
  const [request, setRequest] = useState<OpenTaskOptions>({});
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<TaskStatus>("open");
  const [projectId, setProjectId] = useState(NONE);
  const [pending, setPending] = useState(false);

  const openTaskCreator = useCallback((next: OpenTaskOptions = {}) => {
    setRequest(next);
    setTitle(next.task?.title ?? next.initialTitle ?? "");
    setAssigneeId(next.task?.assigneeId ?? NONE);
    setPriority(next.task?.priority ?? "medium");
    setDueDate(next.task?.dueDate ?? "");
    setStatus(next.task?.status ?? "open");
    setProjectId(next.task?.projectId ?? NONE);
    setOpen(true);
    if (!options) {
      void getContextualTaskOptions()
        .then(setOptions)
        .catch(() => toast.error(tCommon("error")));
    }
  }, [options, tCommon]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLocaleLowerCase() === "a"
      ) {
        event.preventDefault();
        openTaskCreator();
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [openTaskCreator]);

  const value = useMemo(() => ({ openTaskCreator }), [openTaskCreator]);
  const origin = request.origin ?? defaultOrigin(
    pathname,
    typeof window === "undefined" ? "" : window.location.search.slice(1),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await upsertContextualTask({
        id: request.task?.id,
        title,
        assigneeId: assigneeId === NONE ? null : assigneeId,
        priority,
        dueDate: dueDate || null,
        status,
        projectId: projectId === NONE ? null : projectId,
        context: request.task && !request.origin
          ? null
          : {
              ...origin,
              anchorJson: JSON.stringify(origin.anchor ?? {}),
            },
      });
      request.onCreated?.(result.id);
      toast.success(request.task ? t("updated") : t("created"));
      setOpen(false);
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <TaskCreatorContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{request.task ? t("editTask") : t("createTask")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            <div className="flex items-start gap-3 rounded-lg border border-indigo-200/70 bg-indigo-50/60 px-3 py-2.5 text-sm dark:border-indigo-900 dark:bg-indigo-950/25">
              <MapPin className="mt-0.5 size-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
              <div className="min-w-0">
                <p className="font-medium">{t(`origins.${origin.type}`)}</p>
                <p className="truncate text-xs text-muted-foreground">{origin.label || origin.route}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="context-task-title">{t("title")}</Label>
              <Input
                id="context-task-title"
                autoFocus
                required
                maxLength={300}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("titlePlaceholder")}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("assignee")}</Label>
                <Select value={assigneeId} onValueChange={(value) => setAssigneeId(value ?? NONE)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("unassigned")}</SelectItem>
                    {options?.members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("priority")}</Label>
                <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t("priorities.low")}</SelectItem>
                    <SelectItem value="medium">{t("priorities.medium")}</SelectItem>
                    <SelectItem value="high">{t("priorities.high")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="context-task-due">{t("dueDate")}</Label>
                <Input id="context-task-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("status")}</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{t("statuses.open")}</SelectItem>
                    <SelectItem value="done">{t("statuses.done")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("project")}</Label>
              <Select value={projectId} onValueChange={(value) => setProjectId(value ?? NONE)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noProject")}</SelectItem>
                  {options?.projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tCommon("cancel")}</Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? <Loader2 className="animate-spin" /> : request.task ? <Save /> : <Check />}
                {request.task ? t("save") : t("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </TaskCreatorContext.Provider>
  );
}
