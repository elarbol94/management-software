"use client";

import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskOrigin } from "../types";

export function WorkItemOriginCard({
  origin,
  typeLabel,
  tone,
}: {
  origin: TaskOrigin;
  typeLabel: string;
  tone: "task" | "deadline";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/35 px-3.5 py-3">
      <span className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg",
        tone === "task"
          ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
      )}>
        <MapPin className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{typeLabel}</p>
        <p className="truncate text-sm">{origin.label || origin.route}</p>
      </div>
    </div>
  );
}

export function WorkItemFieldError({ children }: { children?: string }) {
  if (!children) return null;
  return <p role="alert" className="text-xs font-medium text-destructive">{children}</p>;
}

export function WorkItemSaveError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">
      {children}
    </div>
  );
}
