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
import { CalendarClock, CalendarDays, Check, Clock3, Loader2, Save, X } from "lucide-react";
import {
  getContextualTaskOptions,
  upsertContextualDeadline,
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
import { Textarea } from "@/components/ui/textarea";
import { localDeadlineToUtc, localTimeFromIso } from "../deadline-utils";
import {
  WorkItemFieldError,
  WorkItemOriginCard,
  WorkItemSaveError,
} from "./work-item-form";
import type {
  EditableDeadline,
  TaskOrigin,
  TaskStatus,
} from "../types";

type OpenDeadlineOptions = {
  origin?: TaskOrigin;
  deadline?: EditableDeadline;
  initialTitle?: string;
  initialDescription?: string;
  onCreated?: (deadlineId: string) => void;
};

type DeadlineCreatorContextValue = {
  openDeadlineCreator: (options?: OpenDeadlineOptions) => void;
};

const DeadlineCreatorContext = createContext<DeadlineCreatorContextValue | null>(null);
const NONE = "none";

export function useDeadlineCreator() {
  const value = useContext(DeadlineCreatorContext);
  if (!value) throw new Error("useDeadlineCreator must be used inside DeadlineCreateProvider");
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

export function DeadlineCreateProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("deadlines");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof getContextualTaskOptions>> | null>(null);
  const [request, setRequest] = useState<OpenDeadlineOptions>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [hasTime, setHasTime] = useState(false);
  const [status, setStatus] = useState<TaskStatus>("open");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{
    title?: string;
    date?: string;
    time?: string;
    save?: string;
  }>({});

  const openDeadlineCreator = useCallback((next: OpenDeadlineOptions = {}) => {
    setRequest(next);
    setTitle(next.deadline?.title ?? next.initialTitle ?? "");
    setDescription(next.deadline?.description ?? next.initialDescription ?? "");
    setAssigneeId(next.deadline?.assigneeId ?? NONE);
    setDeadlineDate(next.deadline?.deadlineDate ?? "");
    setDeadlineTime(localTimeFromIso(next.deadline?.deadlineAt ?? null));
    setHasTime(Boolean(next.deadline?.deadlineAt));
    setStatus(next.deadline?.status ?? "open");
    setErrors({});
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
        event.key.toLocaleLowerCase() === "d"
      ) {
        event.preventDefault();
        openDeadlineCreator();
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [openDeadlineCreator]);

  const value = useMemo(() => ({ openDeadlineCreator }), [openDeadlineCreator]);
  const origin = request.origin ?? defaultOrigin(
    pathname,
    typeof window === "undefined" ? "" : window.location.search.slice(1),
  );
  const assigneeLabel = assigneeId === NONE
    ? t("unassigned")
    : options?.members.find((member) => member.id === assigneeId)?.name ?? assigneeId;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = {
      title: title.trim() ? undefined : t("titleRequired"),
      date: deadlineDate ? undefined : t("dateRequired"),
      time: hasTime && !deadlineTime ? t("timeRequired") : undefined,
    };
    if (nextErrors.title || nextErrors.date || nextErrors.time) {
      setErrors(nextErrors);
      return;
    }
    const deadlineAt = hasTime
      ? localDeadlineToUtc(deadlineDate, deadlineTime)
      : null;
    if (hasTime && !deadlineAt) {
      setErrors({ time: t("timeInvalid") });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const result = await upsertContextualDeadline({
        id: request.deadline?.id,
        title,
        description,
        assigneeId: assigneeId === NONE ? null : assigneeId,
        deadlineAt,
        localDate: deadlineDate,
        status,
        context: request.deadline && !request.origin
          ? null
          : {
              ...origin,
              anchorJson: JSON.stringify(origin.anchor ?? {}),
            },
      });
      request.onCreated?.(result.id);
      toast.success(request.deadline ? t("updated") : t("created"));
      setOpen(false);
    } catch {
      setErrors({ save: t("saveError") });
    } finally {
      setPending(false);
    }
  }

  return (
    <DeadlineCreatorContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(92dvh,48rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="shrink-0 space-y-1 px-6 pb-5 pt-6">
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              <CalendarClock className="size-5" />
            </div>
            <DialogTitle className="text-xl">
              {request.deadline ? t("editDeadline") : t("createDeadline")}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">{t("dialogDescription")}</p>
          </DialogHeader>
          <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-5 overflow-y-auto px-6 pb-5">
              <WorkItemOriginCard
                origin={origin}
                typeLabel={t(`origins.${origin.type}`)}
                tone="deadline"
              />
              <div className="space-y-2">
              <Label htmlFor="deadline-title">{t("title")}</Label>
              <Input
                id="deadline-title"
                autoFocus
                required
                maxLength={300}
                value={title}
                aria-invalid={Boolean(errors.title)}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setErrors((current) => ({ ...current, title: undefined, save: undefined }));
                }}
                placeholder={t("titlePlaceholder")}
              />
              <WorkItemFieldError>{errors.title}</WorkItemFieldError>
              </div>
              <div className="space-y-2">
              <Label htmlFor="deadline-description">{t("description")}</Label>
              <Textarea
                id="deadline-description"
                maxLength={5000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setErrors((current) => ({ ...current, save: undefined }));
                }}
                placeholder={t("descriptionPlaceholder")}
                rows={3}
              />
              </div>
              <div className="rounded-xl border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{t("timing")}</p>
                  <p className="text-xs text-muted-foreground">{hasTime ? t("timingExact") : t("timingAllDay")}</p>
                </div>
                {hasTime ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHasTime(false);
                      setDeadlineTime("");
                      setErrors((current) => ({ ...current, time: undefined, save: undefined }));
                    }}
                  >
                    <X className="size-3.5" />
                    {t("removeTime")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setHasTime(true)}
                  >
                    <Clock3 className="size-3.5" />
                    {t("addTime")}
                  </Button>
                )}
              </div>
              <div className={`grid gap-3 ${hasTime ? "sm:grid-cols-2" : ""}`}>
                <div className="space-y-2">
                  <Label htmlFor="deadline-date">{t("date")}</Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="deadline-date"
                      type="date"
                      required
                      value={deadlineDate}
                      aria-invalid={Boolean(errors.date)}
                      className="pl-9"
                      onChange={(event) => {
                        setDeadlineDate(event.target.value);
                        setErrors((current) => ({ ...current, date: undefined, save: undefined }));
                      }}
                    />
                  </div>
                  <WorkItemFieldError>{errors.date}</WorkItemFieldError>
                </div>
                {hasTime && (
                  <div className="space-y-2">
                    <Label htmlFor="deadline-time">{t("time")}</Label>
                    <div className="relative">
                      <Clock3 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="deadline-time"
                        type="time"
                        required
                        value={deadlineTime}
                        aria-invalid={Boolean(errors.time)}
                        className="pl-9 font-mono"
                        onChange={(event) => {
                          setDeadlineTime(event.target.value);
                          setErrors((current) => ({ ...current, time: undefined, save: undefined }));
                        }}
                      />
                    </div>
                    <WorkItemFieldError>{errors.time}</WorkItemFieldError>
                  </div>
                )}
              </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("assignee")}</Label>
                <Select value={assigneeId} onValueChange={(next) => setAssigneeId(next ?? NONE)}>
                  <SelectTrigger className="w-full"><SelectValue>{assigneeLabel}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("unassigned")}</SelectItem>
                    {options?.members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("status")}</Label>
                <Select value={status} onValueChange={(next) => setStatus(next as TaskStatus)}>
                  <SelectTrigger className="w-full"><SelectValue>{t(`statuses.${status}`)}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{t("statuses.open")}</SelectItem>
                    <SelectItem value="done">{t("statuses.done")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              </div>
              <WorkItemSaveError>{errors.save}</WorkItemSaveError>
            </div>
            <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tCommon("cancel")}</Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : request.deadline ? <Save /> : <Check />}
                {request.deadline ? t("save") : t("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DeadlineCreatorContext.Provider>
  );
}
