"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  FileSearch,
  FolderKanban,
  Link2,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  findContextCandidates,
  getEntityContext,
  linkContext,
  restoreContextLink,
  unlinkContext,
} from "../actions";
import type {
  ContextCandidateDto,
  ContextEntityType,
  ContextItemDto,
  EntityContextDto,
} from "../types";

const empty: EntityContextDto = {
  parents: [],
  tasks: [],
  wiki: [],
  sources: [],
};

class RequestGate {
  private current = 0;

  next() {
    this.current += 1;
    return this.current;
  }

  isCurrent(request: number) {
    return request === this.current;
  }

  invalidate() {
    this.current += 1;
  }
}

function ItemIcon({ type }: { type: ContextEntityType }) {
  if (type === "project") return <FolderKanban className="size-3.5" />;
  if (type === "task") return <ClipboardCheck className="size-3.5" />;
  if (type === "wikiPage") return <BookOpen className="size-3.5" />;
  return <FileSearch className="size-3.5" />;
}

function groupFor(type: ContextEntityType) {
  if (type === "project") return "projects";
  if (type === "task") return "tasks";
  if (type === "wikiPage") return "wiki";
  return "sources";
}

type ContextPanelProps = {
  subjectType: ContextEntityType;
  subjectId: string;
  subjectLabel: string;
  subjectHref: string;
  compact?: boolean;
  accentColor?: string;
  className?: string;
  title?: string;
  initialContext?: EntityContextDto;
};

export function ContextPanel(props: ContextPanelProps) {
  return (
    <ContextPanelContent
      key={`${props.subjectType}:${props.subjectId}`}
      {...props}
    />
  );
}

function ContextPanelContent({
  subjectType,
  subjectId,
  subjectLabel,
  subjectHref,
  compact = false,
  accentColor = "#4f46e5",
  className,
  title,
  initialContext,
}: ContextPanelProps) {
  const locale = useLocale();
  const de = locale !== "en";
  const labels = de
    ? {
        context: "Kontext",
        belongs: "Gehört zu",
        tasks: "Aufgaben",
        wiki: "Wiki",
        sources: "Quellen & Nachweise",
        link: "Verknüpfen",
        choose: "Kontext verknüpfen",
        search: "Projekte, Aufgaben, Wiki und Quellen suchen…",
        empty: "Noch keine Verknüpfungen.",
        more: "Alle anzeigen",
        less: "Weniger anzeigen",
        removed: "Verknüpfung entfernt",
        undo: "Rückgängig",
        noResults: "Keine passenden Einträge gefunden.",
        retry: "Erneut versuchen",
        loadFailed: "Der Kontext konnte nicht geladen werden.",
        searchFailed: "Die Suche ist momentan nicht verfügbar.",
        linkFailed: "Die Verknüpfung konnte nicht erstellt werden.",
        removeFailed: "Die Verknüpfung konnte nicht entfernt werden.",
      }
    : {
        context: "Context",
        belongs: "Belongs to",
        tasks: "Tasks",
        wiki: "Wiki",
        sources: "Sources & evidence",
        link: "Link",
        choose: "Link context",
        search: "Search projects, tasks, wiki and sources…",
        empty: "No links yet.",
        more: "Show all",
        less: "Show less",
        removed: "Link removed",
        undo: "Undo",
        noResults: "No matching items found.",
        retry: "Try again",
        loadFailed: "Context could not be loaded.",
        searchFailed: "Search is temporarily unavailable.",
        linkFailed: "The link could not be created.",
        removeFailed: "The link could not be removed.",
      };
  const [context, setContext] = useState<EntityContextDto>(
    initialContext ?? empty,
  );
  const [loading, setLoading] = useState(!initialContext);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ContextCandidateDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [linkingId, setLinkingId] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [mobileCollapsed, setMobileCollapsed] = useState<Record<string, boolean>>(
    {},
  );
  const subjectKey = `${subjectType}:${subjectId}`;
  const [requestGate] = useState(() => new RequestGate());

  async function load(requestedSubject = subjectKey) {
    if (requestedSubject !== subjectKey) return;
    const request = requestGate.next();
    setLoading(true);
    setLoadFailed(false);
    try {
      const next = await getEntityContext({ type: subjectType, id: subjectId });
      if (requestGate.isCurrent(request)) {
        setContext(next);
      }
    } catch {
      if (requestGate.isCurrent(request)) {
        setLoadFailed(true);
      }
    } finally {
      if (requestGate.isCurrent(request)) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    const requestedSubject = subjectKey;
    const request = requestGate.next();
    void getEntityContext({ type: subjectType, id: subjectId })
      .then((next) => {
        if (
          requestGate.isCurrent(request) &&
          requestedSubject === subjectKey
        ) {
          setContext(next);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        if (
          requestGate.isCurrent(request) &&
          requestedSubject === subjectKey
        ) {
          setLoadFailed(!initialContext);
        }
      })
      .finally(() => {
        if (
          requestGate.isCurrent(request) &&
          requestedSubject === subjectKey
        ) {
          setLoading(false);
        }
      });
    return () => {
      if (requestGate.isCurrent(request)) requestGate.invalidate();
    };
  }, [initialContext, requestGate, subjectId, subjectKey, subjectType]);

  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchFailed(false);
      void findContextCandidates({ subjectType, query })
        .then((next) => {
          if (!cancelled) setCandidates(next);
        })
        .catch(() => {
          if (!cancelled) {
            setCandidates([]);
            setSearchFailed(true);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, query ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pickerOpen, query, subjectType]);

  const groups = useMemo(
    () => [
      { key: "parents", label: labels.belongs, items: context.parents },
      { key: "tasks", label: labels.tasks, items: context.tasks },
      { key: "wiki", label: labels.wiki, items: context.wiki },
      { key: "sources", label: labels.sources, items: context.sources },
    ],
    [context, labels.belongs, labels.sources, labels.tasks, labels.wiki],
  );
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  async function add(candidate: ContextCandidateDto) {
    setLinkingId(`${candidate.type}:${candidate.id}`);
    try {
      const subjectIsOwner = subjectType === "project" || subjectType === "task";
      await linkContext(
        subjectIsOwner
          ? {
              ownerType: subjectType,
              ownerId: subjectId,
              targetType: candidate.type as "wikiPage" | "wikiSource" | "pdf" | "app",
              targetId: candidate.id,
              relation: "related",
              route: candidate.href,
              label: candidate.title,
              anchorJson: "{}",
            }
          : {
              ownerType: candidate.type as "project" | "task",
              ownerId: candidate.id,
              targetType: subjectType as "wikiPage" | "wikiSource" | "pdf" | "app",
              targetId: subjectId,
              relation: "related",
              route: subjectHref,
              label: subjectLabel,
              anchorJson: "{}",
            },
      );
      setPickerOpen(false);
      setQuery("");
      await load();
    } catch {
      toast.error(labels.linkFailed);
    } finally {
      setLinkingId("");
    }
  }

  async function remove(item: ContextItemDto) {
    if (!item.linkId) return;
    try {
      const removed = await unlinkContext(item.linkId);
      await load();
      if (!removed) return;
      toast(labels.removed, {
        action: {
          label: labels.undo,
          onClick: () => {
            void restoreContextLink({
              ownerType: removed.ownerType,
              ownerId: removed.ownerId,
              targetType: removed.targetType,
              targetId: removed.targetId,
              relation: removed.relation,
              route: removed.route,
              label: removed.label,
              anchorJson: removed.anchorJson,
            })
              .then(() => load())
              .catch(() => toast.error(labels.linkFailed));
          },
        },
      });
    } catch {
      toast.error(labels.removeFailed);
    }
  }

  return (
    <section
      className={cn(
        compact ? "space-y-3" : "rounded-xl border bg-card p-4",
        className,
      )}
      data-testid="context-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span
            className="h-4 w-0.5 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
          <Link2 className="size-4 text-indigo-500" />
          {title ?? labels.context}
          {!!total && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {total}
            </span>
          )}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="size-3.5" />
          {labels.link}
        </Button>
      </div>

      {context.parents.length > 0 && (
        <nav
          aria-label={labels.belongs}
          className="flex min-w-0 flex-wrap items-center gap-1 text-xs"
        >
          {context.parents.slice(0, 3).map((item, index) => (
            <span key={item.key} className="contents">
              {index > 0 && (
                <ChevronRight className="size-3 text-muted-foreground" />
              )}
              <Link
                href={item.href}
                className="inline-flex min-w-0 items-center gap-1 rounded-full border bg-background px-2 py-1 font-medium hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
              >
                <ItemIcon type={item.type} />
                <span className="max-w-44 truncate">{item.title}</span>
              </Link>
            </span>
          ))}
          <ChevronRight className="size-3 text-muted-foreground" />
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-muted px-2 py-1">
            <ItemIcon type={subjectType} />
            <span className="max-w-44 truncate">{subjectLabel}</span>
          </span>
        </nav>
      )}

      {loading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : loadFailed ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <span>{labels.loadFailed}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => void load()}>
            {labels.retry}
          </Button>
        </div>
      ) : total === 0 ? (
        <p className="text-xs text-muted-foreground">{labels.empty}</p>
      ) : (
        <div className={cn("grid gap-4", !compact && "md:grid-cols-2")}>
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => {
              const visible = expanded[group.key]
                ? group.items
                : group.items.slice(0, 5);
              return (
                <div key={group.key} className="min-w-0">
                  <button
                    type="button"
                    aria-expanded={!mobileCollapsed[group.key]}
                    className="mb-1.5 flex w-full items-center justify-between text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase md:hidden"
                    onClick={() =>
                      setMobileCollapsed((current) => ({
                        ...current,
                        [group.key]: !current[group.key],
                      }))
                    }
                  >
                    {group.label}
                    <ChevronDown
                      className={cn(
                        "size-3.5 transition-transform",
                        mobileCollapsed[group.key] && "-rotate-90",
                      )}
                    />
                  </button>
                  <p className="mb-1.5 hidden text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase md:block">
                    {group.label}
                  </p>
                  <div
                    className={cn(
                      "space-y-1",
                      mobileCollapsed[group.key] && "hidden md:block",
                    )}
                  >
                    {visible.map((item) => (
                      <div
                        key={item.key}
                        className="group flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-xs transition-colors hover:border-indigo-200 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
                      >
                        <span className="text-indigo-500">
                          <ItemIcon type={item.type} />
                        </span>
                        <Link href={item.href} className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {item.title}
                          </span>
                          {item.subtitle && (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {item.subtitle}
                            </span>
                          )}
                        </Link>
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-60" />
                        {item.removable && item.linkId && (
                          <button
                            type="button"
                            aria-label={de ? "Verknüpfung entfernen" : "Remove link"}
                            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                            onClick={() => void remove(item)}
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {group.items.length > 5 && (
                    <button
                      type="button"
                      className="mt-1 text-[11px] font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                      onClick={() =>
                        setExpanded((current) => ({
                          ...current,
                          [group.key]: !current[group.key],
                        }))
                      }
                    >
                      {expanded[group.key] ? labels.less : `${labels.more} · ${group.items.length}`}
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      )}

      <Dialog
        open={pickerOpen}
        onOpenChange={(next) => {
          setPickerOpen(next);
          if (!next) {
            setQuery("");
            setCandidates([]);
            setSearching(false);
            setSearchFailed(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{labels.choose}</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCandidates([]);
                setSearchFailed(false);
              }}
              placeholder={labels.search}
              className="pl-9"
            />
          </div>
          <div className="max-h-[24rem] space-y-4 overflow-y-auto">
            {searching ? (
              <Loader2 className="mx-auto my-8 size-5 animate-spin text-muted-foreground" />
            ) : searchFailed ? (
              <p
                role="alert"
                className="py-8 text-center text-sm text-destructive"
              >
                {labels.searchFailed}
              </p>
            ) : candidates.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {labels.noResults}
              </p>
            ) : (
              ["projects", "tasks", "wiki", "sources"].map((group) => {
                const items = candidates.filter(
                  (candidate) => groupFor(candidate.type) === group,
                );
                if (!items.length) return null;
                const heading = {
                  projects: de ? "Projekte" : "Projects",
                  tasks: labels.tasks,
                  wiki: labels.wiki,
                  sources: labels.sources,
                }[group];
                return (
                  <section key={group}>
                    <p className="mb-1 px-1 text-[10px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
                      {heading}
                    </p>
                    <div className="space-y-1">
                      {items.map((candidate) => {
                        const key = `${candidate.type}:${candidate.id}`;
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={linkingId === key}
                            onClick={() => void add(candidate)}
                            className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-60 dark:hover:bg-indigo-950/30"
                          >
                            <span className="text-indigo-500">
                              {linkingId === key ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <ItemIcon type={candidate.type} />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {candidate.title}
                              </span>
                              {candidate.subtitle && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {candidate.subtitle}
                                </span>
                              )}
                            </span>
                            <Plus className="size-4 text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
