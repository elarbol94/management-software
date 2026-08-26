"use client";

import { Fragment, useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { buildRevisionDiff, type DiffCell } from "../lib/revision-diff";

function DiffLine({ cell, side }: { cell: DiffCell; side: "old" | "current" }) {
  const t = useTranslations("wiki");
  const changed = cell.kind === "removed" || cell.kind === "added";
  const sign = cell.kind === "removed" ? "−" : cell.kind === "added" ? "+" : "";
  return <div
    className={cn(
      "grid min-w-0 grid-cols-[3.5rem_1.5rem_minmax(0,1fr)] font-mono text-xs leading-6",
      side === "old" && "border-r",
      cell.kind === "removed" && "bg-red-50 dark:bg-red-950/35",
      cell.kind === "added" && "bg-green-50 dark:bg-green-950/35",
      cell.kind === "empty" && "bg-muted/25",
    )}
    data-testid={`revision-diff-${side}`}
    aria-label={changed ? t(cell.kind === "removed" ? "diffRemovedLine" : "diffAddedLine", { line: cell.lineNumber ?? 0 }) : undefined}
  >
    <span className="select-none border-r px-2 text-right text-muted-foreground">{cell.lineNumber ?? ""}</span>
    <span className={cn("select-none text-center", cell.kind === "removed" && "text-red-700 dark:text-red-300", cell.kind === "added" && "text-green-700 dark:text-green-300")}>{sign}</span>
    <span className="min-w-0 pr-4 break-words whitespace-pre-wrap">
      {cell.parts.map((part, index) => <span key={index} className={cn(
        part.changed && side === "old" && "rounded-sm bg-red-200 text-red-950 dark:bg-red-800/70 dark:text-red-50",
        part.changed && side === "current" && "rounded-sm bg-green-200 text-green-950 dark:bg-green-800/70 dark:text-green-50",
      )}>{part.text}</span>)}
      {!cell.text && cell.kind !== "empty" ? " " : null}
    </span>
  </div>;
}

export function RevisionDiffView({
  oldText,
  currentText,
  oldTitle,
  currentTitle,
}: {
  oldText: string;
  currentText: string;
  oldTitle: string;
  currentTitle: string;
}) {
  const rows = useMemo(() => buildRevisionDiff(oldText, currentText), [currentText, oldText]);

  // ponytail: one scroll container with a two-column grid — each row pair shares a grid row,
  // so wrapped lines stay aligned without any scroll-syncing code.
  return <div className="max-h-[60dvh] min-h-0 overflow-auto rounded-md border" data-testid="revision-diff">
    <div className="grid grid-cols-2">
      <h3 className="sticky top-0 z-10 border-r border-b bg-muted/60 px-2 py-1.5 text-sm font-medium backdrop-blur">{oldTitle}</h3>
      <h3 className="sticky top-0 z-10 border-b bg-muted/60 px-2 py-1.5 text-sm font-medium backdrop-blur">{currentTitle}</h3>
      {rows.map((row, index) => <Fragment key={index}>
        <DiffLine cell={row.old} side="old" />
        <DiffLine cell={row.current} side="current" />
      </Fragment>)}
    </div>
  </div>;
}
