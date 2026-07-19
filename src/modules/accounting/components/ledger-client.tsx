"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Download, Filter, Paperclip, Plus } from "lucide-react";
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
  const tBookings = useTranslations("accountingBookings");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogEntry, setDialogEntry] = useState<EntryRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function setParam(key: string, value: string | null | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/accounting/bookings?${params.toString()}`);
  }

  function monthName(month: number) {
    return format.dateTime(new Date(2026, month - 1, 1), { month: "long" });
  }

  const exportHref = filters.month
    ? `/api/accounting/export?year=${filters.year}&month=${filters.month}`
    : `/api/accounting/export?year=${filters.year}`;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-[#dfe5e1] bg-white p-4 shadow-[0_1px_2px_rgba(20,47,39,0.03)] sm:p-5">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-[#71807a] uppercase">
          <Filter className="size-3.5" />
          {tBookings("filters")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(filters.year)}
            onValueChange={(value) => setParam("year", value)}
          >
            <SelectTrigger
              aria-label={t("year")}
              className="w-28 border-[#d4ddd8] bg-[#fbfcfb]"
            >
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
            <SelectTrigger
              aria-label={t("month")}
              className="w-40 border-[#d4ddd8] bg-[#fbfcfb]"
            >
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
            <SelectTrigger
              aria-label={tBookings("type")}
              className="w-36 border-[#d4ddd8] bg-[#fbfcfb]"
            >
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
            <SelectTrigger
              aria-label={t("category")}
              className="w-56 max-w-full border-[#d4ddd8] bg-[#fbfcfb]"
            >
              <SelectValue>
                {filters.categoryId
                  ? (categories.find((category) => category.id === filters.categoryId)
                      ?.name ?? "")
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
              render={<a href={exportHref} />}
              className="border-[#d4ddd8] bg-white text-[#315c73] hover:bg-[#edf2f0] hover:text-[#234758]"
            >
              <Download className="size-4" />
              {t("exportCsv")}
            </Button>
            <Button
              size="sm"
              className="bg-[#173c32] px-3 text-white hover:bg-[#245345]"
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
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#dfe5e1] bg-white shadow-[0_1px_2px_rgba(20,47,39,0.03)]">
        <Table>
          <TableHeader className="bg-[#f8faf8]">
            <TableRow className="border-[#e3e8e5] hover:bg-transparent">
              <TableHead className="h-10 w-28 pl-5 text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase sm:pl-6">
                {t("date")}
              </TableHead>
              <TableHead className="h-10 text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase">
                {t("description")}
              </TableHead>
              <TableHead className="hidden h-10 text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase md:table-cell">
                {t("counterparty")}
              </TableHead>
              <TableHead className="h-10 text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase">
                {t("category")}
              </TableHead>
              <TableHead className="hidden h-10 text-right text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase lg:table-cell">
                {t("net")}
              </TableHead>
              <TableHead className="hidden h-10 text-right text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase xl:table-cell">
                {t("vat")}
              </TableHead>
              <TableHead className="h-10 pr-5 text-right text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase sm:pr-6">
                {t("gross")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-40 text-center text-[#7a8782]">
                  {t("noEntries")}
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => {
              const sign = entry.kind === "expense" ? -1 : 1;
              return (
                <TableRow
                  key={entry.id}
                  tabIndex={0}
                  className="cursor-pointer border-[#edf0ee] hover:bg-[#f6f9f7] focus-visible:bg-[#f0f5f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#315c73]"
                  onClick={() => {
                    setDialogEntry(entry);
                    setDialogOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setDialogEntry(entry);
                    setDialogOpen(true);
                  }}
                >
                  <TableCell className="whitespace-nowrap pl-5 text-[#68756f] sm:pl-6">
                    {format.dateTime(new Date(entry.date), {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="max-w-72">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[#213c35]">
                          {entry.description}
                        </span>
                        <span className="block truncate text-xs text-[#84908c] md:hidden">
                          {entry.counterparty}
                        </span>
                      </span>
                      {entry.attachmentCount > 0 && (
                        <Paperclip className="size-3.5 shrink-0 text-[#83918b]" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-48 truncate text-[#71807a] md:table-cell">
                    {entry.counterparty}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-[#dfe5e1] bg-[#fafbfa] text-[#52625c]"
                    >
                      <span
                        className="mr-1 inline-block size-2 rounded-full"
                        style={{ backgroundColor: entry.categoryColor }}
                      />
                      {entry.categoryName}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums text-[#5c6b66] lg:table-cell">
                    {formatCents(sign * entry.netAmountCents, locale)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums text-[#87938f] xl:table-cell">
                    {formatCents(sign * entry.vatAmountCents, locale)}
                  </TableCell>
                  <TableCell
                    className={`pr-5 text-right font-semibold tabular-nums sm:pr-6 ${
                      entry.kind === "income" ? "text-[#2f6b55]" : "text-[#273f38]"
                    }`}
                  >
                    {formatCents(sign * entry.grossAmountCents, locale)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section
        aria-label={tBookings("periodTotals")}
        className="grid overflow-hidden rounded-2xl border border-[#dfe5e1] bg-white shadow-[0_1px_2px_rgba(20,47,39,0.03)] sm:grid-cols-3"
      >
        <div className="p-4 sm:p-5">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase">
            {t("incomePlural")}
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-[#2f6b55]">
            {formatCents(totals.incomeGross, locale)}
          </p>
        </div>
        <div className="border-t border-[#e3e8e5] p-4 sm:border-t-0 sm:border-l sm:p-5">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase">
            {t("expensePlural")}
          </p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-[#273f38]">
            {formatCents(
              totals.expenseGross === 0 ? 0 : -totals.expenseGross,
              locale,
            )}
          </p>
        </div>
        <div className="border-t border-[#e3e8e5] bg-[#f8faf8] p-4 sm:border-t-0 sm:border-l sm:p-5">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase">
            {t("balance")}
          </p>
          <p
            className={`mt-2 text-lg font-semibold tabular-nums ${
              totals.balance >= 0 ? "text-[#2f6b55]" : "text-[#a64f3c]"
            }`}
          >
            {formatCents(totals.balance, locale)}
          </p>
        </div>
      </section>

      <EntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={dialogEntry}
        categories={categories}
      />
    </div>
  );
}
