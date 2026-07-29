"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import {
  BookOpen,
  ClipboardCheck,
  FileSearch,
  FolderKanban,
  Loader2,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchWorkspace } from "../actions";
import type {
  ContextEntityType,
  WorkspaceSearchResultDto,
} from "../types";

function ResultIcon({ type }: { type: ContextEntityType }) {
  if (type === "project") return <FolderKanban className="size-4" />;
  if (type === "task") return <ClipboardCheck className="size-4" />;
  if (type === "wikiPage") return <BookOpen className="size-4" />;
  return <FileSearch className="size-4" />;
}

export function WorkspaceSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const locale = useLocale();
  const de = locale !== "en";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResultDto[]>([]);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        onOpenChange(true);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPending(true);
      void searchWorkspace(query)
        .then((next) => {
          if (!cancelled) {
            setResults(next);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setFailed(true);
          }
        })
        .finally(() => {
          if (!cancelled) setPending(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, retryVersion]);

  function changeOpen(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setResults([]);
      setPending(false);
      setFailed(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
    >
      <DialogContent className="top-[14vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>
            {de ? "Arbeitsbereich durchsuchen" : "Search workspace"}
          </DialogTitle>
        </DialogHeader>
        <div className="relative border-b">
          <Search className="absolute top-5 left-5 size-5 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              setResults([]);
              setFailed(false);
              setPending(next.trim().length >= 2);
            }}
            placeholder={
              de
                ? "Projekte, Aufgaben, Wiki und Quellen durchsuchen…"
                : "Search projects, tasks, wiki and sources…"
            }
            className="h-14 rounded-none border-0 bg-transparent pr-16 pl-13 text-base shadow-none focus-visible:ring-0"
          />
          <kbd className="absolute top-4.5 right-4 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div className="max-h-[min(32rem,65dvh)] overflow-y-auto p-2">
          {pending ? (
            <div
              className="grid place-items-center py-10"
              role="status"
              aria-label={de ? "Suche läuft" : "Searching"}
            >
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : query.trim().length < 2 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {de
                ? "Mindestens zwei Zeichen eingeben."
                : "Enter at least two characters."}
            </p>
          ) : failed ? (
            <div
              role="alert"
              className="grid justify-items-center gap-3 py-10 text-center text-sm text-destructive"
            >
              <p>
                {de
                  ? "Die Suche ist momentan nicht verfügbar."
                  : "Search is temporarily unavailable."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setFailed(false);
                  setPending(true);
                  setRetryVersion((value) => value + 1);
                }}
              >
                {de ? "Erneut versuchen" : "Try again"}
              </Button>
            </div>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {de ? "Keine passenden Einträge gefunden." : "No matching items found."}
            </p>
          ) : (
            <div className="space-y-1">
              {results.map((result) => (
                <Link
                  key={`${result.type}:${result.id}:${result.href}`}
                  href={result.href}
                  onClick={() => changeOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
                    <ResultIcon type={result.type} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {result.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.path}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
