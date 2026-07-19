"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  BarChart3,
  CalendarRange,
  Download,
  FileText,
  Paperclip,
  Plus,
} from "lucide-react";
import { formatCents } from "@/lib/money";
import type { EntryFilters, EntryRow } from "@/modules/accounting/queries";
import type { categories as categoriesTable } from "@/modules/accounting/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { EntryDialog } from "./entry-dialog";

type Category = typeof categoriesTable.$inferSelect;

export function LedgerClient({
  entries,
  totals,
  categories,
  years,
  filters,
}: {
  entries: EntryRow[];
  totals: { incomeGross: number; expenseGross: number; balance: number };
  categories: Category[];
  years: number[];
  filters: EntryFilters;
}) {
  const t = useTranslations("accounting");
  const tInvoices = useTranslations("invoices");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogEntry, setDialogEntry] = useState<EntryRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function setParam(key: string, value: string | null | undefined) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/accounting?${params.toString()}`);
  }

  function monthName(month: number) {
    return format.dateTime(new Date(2026, month - 1, 1), { month: "long" });
  }

  const exportHref = filters.month
    ? `/api/accounting/export?year=${filters.year}&month=${filters.month}`
    : `/api/accounting/export?year=${filters.year}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(filters.year)}
          onValueChange={(value) => setParam("year", value)}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.month ? String(filters.month) : "all"}
          onValueChange={(value) =>
            setParam("month", value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue>
              {filters.month ? monthName(filters.month) : t("wholeYear")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("wholeYear")}</SelectItem>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <SelectItem key={month} value={String(month)}>
                {monthName(month)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.kind ?? "all"}
          onValueChange={(value) =>
            setParam("kind", value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue>
              {filters.kind
                ? t(filters.kind === "income" ? "incomePlural" : "expensePlural")
                : t("all")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            <SelectItem value="income">{t("incomePlural")}</SelectItem>
            <SelectItem value="expense">{t("expensePlural")}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.categoryId ?? "all"}
          onValueChange={(value) =>
            setParam("category", value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue>
              {filters.categoryId
                ? (categories.find((c) => c.id === filters.categoryId)?.name ?? "")
                : t("allCategories")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allCategories")}</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/accounting/invoices" />}
          >
            <FileText className="size-4" />
            {tInvoices("title")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/accounting/planning" />}
          >
            <CalendarRange className="size-4" />
            {t("planning")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/accounting/report" />}
          >
            <BarChart3 className="size-4" />
            {t("report")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={exportHref} />}
          >
            <Download className="size-4" />
            {t("exportCsv")}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setDialogEntry(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("newEntry")}
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">{t("date")}</TableHead>
              <TableHead>{t("description")}</TableHead>
              <TableHead>{t("counterparty")}</TableHead>
              <TableHead>{t("category")}</TableHead>
              <TableHead className="text-right">{t("net")}</TableHead>
              <TableHead className="text-right">{t("vat")}</TableHead>
              <TableHead className="text-right">{t("gross")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("noEntries")}
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => {
              const sign = entry.kind === "expense" ? -1 : 1;
              return (
                <TableRow
                  key={entry.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setDialogEntry(entry);
                    setDialogOpen(true);
                  }}
                >
                  <TableCell className="whitespace-nowrap">
                    {format.dateTime(new Date(entry.date), {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="max-w-72">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {entry.description}
                      </span>
                      {entry.attachmentCount > 0 && (
                        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">
                    {entry.counterparty}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      style={{ borderColor: entry.categoryColor }}
                    >
                      <span
                        className="mr-1 inline-block size-2 rounded-full"
                        style={{ backgroundColor: entry.categoryColor }}
                      />
                      {entry.categoryName}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(sign * entry.netAmountCents, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCents(sign * entry.vatAmountCents, locale)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium tabular-nums ${
                      entry.kind === "income" ? "text-green-700 dark:text-green-500" : ""
                    }`}
                  >
                    {formatCents(sign * entry.grossAmountCents, locale)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap justify-end gap-6 text-sm">
        <span>
          {t("incomePlural")}:{" "}
          <span className="font-semibold tabular-nums text-green-700 dark:text-green-500">
            {formatCents(totals.incomeGross, locale)}
          </span>
        </span>
        <span>
          {t("expensePlural")}:{" "}
          <span className="font-semibold tabular-nums">
            {formatCents(totals.expenseGross === 0 ? 0 : -totals.expenseGross, locale)}
          </span>
        </span>
        <span>
          {t("balance")}:{" "}
          <span
            className={`font-semibold tabular-nums ${
              totals.balance >= 0
                ? "text-green-700 dark:text-green-500"
                : "text-destructive"
            }`}
          >
            {formatCents(totals.balance, locale)}
          </span>
        </span>
      </div>

      <EntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={dialogEntry}
        categories={categories}
      />
    </div>
  );
}
