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
import { CalendarClock, Check, Loader2, MapPin, Save } from "lucide-react";
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

function localDateTimeValue(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
  const [deadlineAt, setDeadlineAt] = useState("");
  const [status, setStatus] = useState<TaskStatus>("open");
  const [pending, setPending] = useState(false);

  const openDeadlineCreator = useCallback((next: OpenDeadlineOptions = {}) => {
    setRequest(next);
    setTitle(next.deadline?.title ?? next.initialTitle ?? "");
    setDescription(next.deadline?.description ?? next.initialDescription ?? "");
    setAssigneeId(next.deadline?.assigneeId ?? NONE);
    setDeadlineAt(next.deadline?.deadlineAt ? localDateTimeValue(next.deadline.deadlineAt) : "");
    setStatus(next.deadline?.status ?? "open");
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!deadlineAt) return;
    setPending(true);
    try {
      const result = await upsertContextualDeadline({
        id: request.deadline?.id,
        title,
        description,
        assigneeId: assigneeId === NONE ? null : assigneeId,
        deadlineAt: new Date(deadlineAt).toISOString(),
        localDate: deadlineAt.slice(0, 10),
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
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <DeadlineCreatorContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="size-5 text-amber-600" />
              {request.deadline ? t("editDeadline") : t("createDeadline")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-5">
            <div className="flex items-start gap-3 rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/25">
              <MapPin className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="font-medium">{t(`origins.${origin.type}`)}</p>
                <p className="truncate text-xs text-muted-foreground">{origin.label || origin.route}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deadline-title">{t("title")}</Label>
              <Input
                id="deadline-title"
                autoFocus
                required
                maxLength={300}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("titlePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deadline-description">{t("description")}</Label>
              <Textarea
                id="deadline-description"
                maxLength={5000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("descriptionPlaceholder")}
                rows={4}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("assignee")}</Label>
                <Select value={assigneeId} onValueChange={(next) => setAssigneeId(next ?? NONE)}>
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
                <Label htmlFor="deadline-at">{t("dateTime")}</Label>
                <Input
                  id="deadline-at"
                  type="datetime-local"
                  required
                  value={deadlineAt}
                  onChange={(event) => setDeadlineAt(event.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>{t("status")}</Label>
                <Select value={status} onValueChange={(next) => setStatus(next as TaskStatus)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{t("statuses.open")}</SelectItem>
                    <SelectItem value="done">{t("statuses.done")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tCommon("cancel")}</Button>
              <Button type="submit" disabled={pending || !title.trim() || !deadlineAt}>
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
