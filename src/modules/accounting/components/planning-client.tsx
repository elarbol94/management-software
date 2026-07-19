"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { savePlanning, type PlanningInput } from "../actions";
import type { PlanningRow } from "../queries";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Draft = Record<string, string[]>;

function amountForInput(cents: number, locale: string) {
  if (cents === 0) return "";
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function initialDraft(rows: PlanningRow[], locale: string): Draft {
  return Object.fromEntries(
    rows.map((row) => [
      row.categoryId,
      row.plannedByMonth.map((amount) => amountForInput(amount, locale)),
    ]),
  );
}

function draftAmount(value: string) {
  if (!value.trim()) return 0;
  const cents = parseAmountToCents(value);
  return cents !== null && cents >= 0 ? cents : 0;
}

export function PlanningClient({
  rows,
  year,
  years,
  locale,
}: {
  rows: PlanningRow[];
  year: number;
  years: number[];
  locale: string;
}) {
  const t = useTranslations("accounting");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(rows, locale));
  const [invalidCells, setInvalidCells] = useState<Set<string>>(new Set());

  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) =>
        new Intl.DateTimeFormat(locale, { month: "short" }).format(
          new Date(2024, month, 1),
        ),
      ),
    [locale],
  );

  const totals = useMemo(() => {
    let plannedIncome = 0;
    let plannedExpense = 0;
    let actualIncome = 0;
    let actualExpense = 0;
    for (const row of rows) {
      const planned = (draft[row.categoryId] ?? []).reduce(
        (sum, value) => sum + draftAmount(value),
        0,
      );
      const actual = row.actualByMonth.reduce((sum, amount) => sum + amount, 0);
      if (row.kind === "income") {
        plannedIncome += planned;
        actualIncome += actual;
      } else {
        plannedExpense += planned;
        actualExpense += actual;
      }
    }
    return { plannedIncome, plannedExpense, actualIncome, actualExpense };
  }, [draft, rows]);

  function setAmount(categoryId: string, monthIndex: number, value: string) {
    setDraft((current) => ({
      ...current,
      [categoryId]: current[categoryId].map((amount, index) =>
        index === monthIndex ? value : amount,
      ),
    }));
    const key = `${categoryId}-${monthIndex}`;
    setInvalidCells((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  function submit() {
    const amounts: PlanningInput["amounts"] = [];
    const invalid = new Set<string>();
    for (const row of rows) {
      (draft[row.categoryId] ?? []).forEach((value, monthIndex) => {
        const parsed = value.trim() ? parseAmountToCents(value) : 0;
        if (parsed === null || parsed < 0 || parsed > 100_000_000_000) {
          invalid.add(`${row.categoryId}-${monthIndex}`);
          return;
        }
        amounts.push({
          categoryId: row.categoryId,
          month: monthIndex + 1,
          amountCents: parsed,
        });
      });
    }
    setInvalidCells(invalid);
    if (invalid.size > 0) {
      toast.error(t("planningInvalidAmount"));
      return;
    }

    startTransition(async () => {
      try {
        await savePlanning({ year, amounts });
        toast.success(tCommon("saved"));
      } catch {
        toast.error(tCommon("error"));
      }
    });
  }

  function categoryRows(kind: PlanningRow["kind"]) {
    return rows.filter((row) => row.kind === kind);
  }

  function renderCategory(row: PlanningRow) {
    const planned = (draft[row.categoryId] ?? []).reduce(
      (sum, value) => sum + draftAmount(value),
      0,
    );
    const actual = row.actualByMonth.reduce((sum, amount) => sum + amount, 0);
    const difference = actual - planned;
    const favorable = row.kind === "income" ? difference > 0 : difference < 0;
    return (
      <TableRow key={row.categoryId}>
        <TableCell className="sticky left-0 z-10 min-w-52 bg-background font-medium">
          <span className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: row.categoryColor }}
            />
            <span>{row.categoryName}</span>
            {row.archived && <Badge variant="secondary">{t("archived")}</Badge>}
          </span>
        </TableCell>
        {monthNames.map((monthName, monthIndex) => {
          const key = `${row.categoryId}-${monthIndex}`;
          return (
            <TableCell key={monthName} className="min-w-28 px-1.5">
              <Input
                aria-label={`${row.categoryName} ${monthName}`}
                className="h-8 text-right tabular-nums"
                inputMode="decimal"
                value={draft[row.categoryId]?.[monthIndex] ?? ""}
                disabled={pending || row.archived}
                aria-invalid={invalidCells.has(key)}
                placeholder="0,00"
                onChange={(event) =>
                  setAmount(row.categoryId, monthIndex, event.target.value)
                }
              />
            </TableCell>
          );
        })}
        <TableCell className="text-right font-medium tabular-nums">
          {formatCents(planned, locale)}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCents(actual, locale)}
        </TableCell>
        <TableCell
          className={`text-right tabular-nums ${
            difference === 0
              ? "text-muted-foreground"
              : favorable
                ? "text-green-700 dark:text-green-500"
                : "text-destructive"
          }`}
        >
          {formatCents(difference, locale)}
        </TableCell>
      </TableRow>
    );
  }

  const plannedResult = totals.plannedIncome - totals.plannedExpense;
  const actualResult = totals.actualIncome - totals.actualExpense;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t("planningDescription")}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={String(year)}
            onValueChange={(value) => router.push(`/accounting/planning?year=${value}`)}
          >
            <SelectTrigger className="w-28" aria-label={t("year")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={submit} disabled={pending || rows.length === 0}>
            <Save className="size-4" />
            {pending ? tCommon("loading") : t("savePlanning")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("plannedIncome")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums text-green-700 dark:text-green-500">
            {formatCents(totals.plannedIncome, locale)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("plannedExpenses")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCents(totals.plannedExpense, locale)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("plannedResult")}
            </CardTitle>
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold tabular-nums ${
              plannedResult < 0 ? "text-destructive" : ""
            }`}
          >
            {formatCents(plannedResult, locale)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("actualResult")}
            </CardTitle>
          </CardHeader>
          <CardContent
            className={`text-2xl font-semibold tabular-nums ${
              actualResult < 0 ? "text-destructive" : ""
            }`}
          >
            {formatCents(actualResult, locale)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("monthlyPlanning")}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              {t("noPlanningCategories")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-20 min-w-52 bg-background">
                    {t("category")}
                  </TableHead>
                  {monthNames.map((month) => (
                    <TableHead key={month} className="min-w-28 text-right">
                      {month}
                    </TableHead>
                  ))}
                  <TableHead className="min-w-28 text-right">{t("plan")}</TableHead>
                  <TableHead className="min-w-28 text-right">{t("actual")}</TableHead>
                  <TableHead className="min-w-32 text-right">{t("variance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["income", "expense"] as const).map((kind) => {
                  const kindRows = categoryRows(kind);
                  if (kindRows.length === 0) return null;
                  return [
                    <TableRow key={`${kind}-heading`} className="bg-muted/60 hover:bg-muted/60">
                      <TableCell colSpan={16} className="font-semibold">
                        {t(kind === "income" ? "incomePlural" : "expensePlural")}
                      </TableCell>
                    </TableRow>,
                    ...kindRows.map(renderCategory),
                  ];
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
