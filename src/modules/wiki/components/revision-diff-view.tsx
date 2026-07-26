"use client";

import { useMemo, useRef, type UIEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { buildRevisionDiff, type DiffCell } from "../lib/revision-diff";

function DiffLine({ cell, side }: { cell: DiffCell; side: "old" | "current" }) {
  const t = useTranslations("wiki");
  const changed = cell.kind === "removed" || cell.kind === "added";
  const sign = cell.kind === "removed" ? "−" : cell.kind === "added" ? "+" : "";
  return <div
    className={cn(
      "grid h-6 min-w-max grid-cols-[3.5rem_1.5rem_minmax(24rem,1fr)] font-mono text-xs leading-6",
      cell.kind === "removed" && "bg-red-50 dark:bg-red-950/35",
      cell.kind === "added" && "bg-green-50 dark:bg-green-950/35",
      cell.kind === "empty" && "bg-muted/25",
    )}
    aria-label={changed ? t(cell.kind === "removed" ? "diffRemovedLine" : "diffAddedLine", { line: cell.lineNumber ?? 0 }) : undefined}
  >
    <span className="select-none border-r px-2 text-right text-muted-foreground">{cell.lineNumber ?? ""}</span>
    <span className={cn("select-none text-center", cell.kind === "removed" && "text-red-700 dark:text-red-300", cell.kind === "added" && "text-green-700 dark:text-green-300")}>{sign}</span>
    <span className="whitespace-pre pr-4">
      {cell.parts.map((part, index) => <span key={index} className={cn(
        part.changed && side === "old" && "rounded-sm bg-red-200 text-red-950 dark:bg-red-800/70 dark:text-red-50",
        part.changed && side === "current" && "rounded-sm bg-green-200 text-green-950 dark:bg-green-800/70 dark:text-green-50",
      )}>{part.text}</span>)}
      {!cell.text && cell.kind !== "empty" ? " " : null}
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
  const oldRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  function synchronize(event: UIEvent<HTMLDivElement>, target: React.RefObject<HTMLDivElement | null>) {
    const other = target.current;
    if (other && Math.abs(other.scrollTop - event.currentTarget.scrollTop) > 0.5) {
      other.scrollTop = event.currentTarget.scrollTop;
    }
  }

  return <div className="grid min-h-0 grid-cols-2 gap-3" data-testid="revision-diff">
    <section className="min-w-0">
      <h3 className="mb-2 text-sm font-medium">{oldTitle}</h3>
      <div ref={oldRef} onScroll={(event) => synchronize(event, currentRef)} className="max-h-[60dvh] overflow-auto rounded-md border" data-testid="revision-diff-old">
        {rows.map((row, index) => <DiffLine key={index} cell={row.old} side="old" />)}
      </div>
    </section>
    <section className="min-w-0">
      <h3 className="mb-2 text-sm font-medium">{currentTitle}</h3>
      <div ref={currentRef} onScroll={(event) => synchronize(event, oldRef)} className="max-h-[60dvh] overflow-auto rounded-md border" data-testid="revision-diff-current">
        {rows.map((row, index) => <DiffLine key={index} cell={row.current} side="current" />)}
      </div>
    </section>
  </div>;
}
