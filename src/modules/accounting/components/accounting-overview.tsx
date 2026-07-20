"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Landmark,
  Paperclip,
  Plus,
  ReceiptText,
  Scale,
} from "lucide-react";
import { formatCents } from "@/lib/money";
import type {
  EntryRow,
  MonthlySummary,
} from "@/modules/accounting/queries";
import type { categories as categoriesTable } from "@/modules/accounting/schema";
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

const CHART_WIDTH = 720;
const CHART_HEIGHT = 190;
const CHART_X_PADDING = 18;
const CHART_Y_PADDING = 24;

function CashflowChart({
  months,
  year,
}: {
  months: MonthlySummary[];
  year: number;
}) {
  const t = useTranslations("accountingOverview");
  const format = useFormatter();

  const chart = useMemo(() => {
    const balances = months.reduce<number[]>((values, month) => {
      const previous = values.at(-1) ?? 0;
      return [
        ...values,
        previous + month.incomeGross - month.expenseGross,
      ];
    }, []);
    const min = Math.min(0, ...balances);
    const max = Math.max(0, ...balances);
    const range = max - min || 1;
    const isFlat = max === min;
    const plotHeight = CHART_HEIGHT - CHART_Y_PADDING * 2;
    const plotWidth = CHART_WIDTH - CHART_X_PADDING * 2;
    const toY = (value: number) =>
      isFlat
        ? CHART_HEIGHT / 2
        : CHART_Y_PADDING + ((max - value) / range) * plotHeight;
    const points = balances.map((value, index) => ({
      value,
      x: CHART_X_PADDING + (index * plotWidth) / 11,
      y: toY(value),
    }));

    return {
      baseline: toY(0),
      points,
      path: points
        .map((point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`,
        )
        .join(" "),
    };
  }, [months]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.015em] text-[#17342d]">
            {t("cashflowTitle")}
          </h2>
          <p className="mt-1 text-sm text-[#6f7d78]">
            {t("cashflowDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-[#61706b]">
          <span className="size-2 rounded-full bg-[#315c73]" />
          {t("runningBalance")}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="h-48 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          aria-label={t("chartLabel", { year })}
        >
          {[0.25, 0.5, 0.75].map((position) => (
            <line
              key={position}
              x1={CHART_X_PADDING}
              x2={CHART_WIDTH - CHART_X_PADDING}
              y1={CHART_Y_PADDING + position * (CHART_HEIGHT - CHART_Y_PADDING * 2)}
              y2={CHART_Y_PADDING + position * (CHART_HEIGHT - CHART_Y_PADDING * 2)}
              stroke="#e1e7e3"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="3 5"
            />
          ))}
          <line
            x1={CHART_X_PADDING}
            x2={CHART_WIDTH - CHART_X_PADDING}
            y1={chart.baseline}
            y2={chart.baseline}
            stroke="#b9c5c0"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={chart.path}
            fill="none"
            stroke="#315c73"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {chart.points.map((point, index) => (
            <circle
              key={months[index].month}
              cx={point.x}
              cy={point.y}
              r="3.5"
              fill="#f9fbf9"
              stroke="#315c73"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div className="grid grid-cols-12 gap-1 border-t border-[#e3e8e5] pt-3">
          {months.map((month) => (
            <span
              key={month.month}
              className="text-center text-[10px] font-semibold tracking-[0.06em] text-[#87938f] uppercase sm:text-[11px]"
            >
              {format.dateTime(new Date(year, month.month - 1, 1), {
                month: "narrow",
              })}
            </span>
          ))}
        </div>
      </div>

      <table className="sr-only">
        <caption>{t("chartLabel", { year })}</caption>
        <thead>
          <tr>
            <th>{t("month")}</th>
            <th>{t("income")}</th>
            <th>{t("expenses")}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.month}>
              <td>
                {format.dateTime(new Date(year, month.month - 1, 1), {
                  month: "long",
                })}
              </td>
              <td>{month.incomeGross}</td>
              <td>{month.expenseGross}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountingOverview({
  entries,
  months,
  totals,
  vatBalance,
  categories,
  years,
  year,
  canManagePersonnel,
  taxSettings,
  fundingProjects,
  personnelEmployees,
  personnelLocations,
  payrollMonthContexts,
}: {
  entries: EntryRow[];
  months: MonthlySummary[];
  totals: { incomeGross: number; expenseGross: number; balance: number };
  vatBalance: number;
  categories: Category[];
  years: number[];
  year: number;
  canManagePersonnel: boolean;
  taxSettings: { kleinunternehmer: boolean; defaultVatRate: number };
  fundingProjects: Array<{ id: string; name: string }>;
  personnelEmployees: Array<{ id: string; name: string; personnelNumber: string; employmentType: string; locationId: string | null }>;
  personnelLocations: Array<{ id: string; name: string; state: string; municipality: string }>;
  payrollMonthContexts: Array<{ payrollMonth: string; internalPayrollCents: number; externalPayrollCents: number; externalMarginalPayrollCents: number; marginalPayrollCents: number }>;
}) {
  const t = useTranslations("accounting");
  const tOverview = useTranslations("accountingOverview");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialogEntry, setDialogEntry] = useState<EntryRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function changeYear(value: string | null) {
    if (!value) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", value);
    router.push(`/accounting?${params.toString()}`);
  }

  const recentEntries = entries.slice(0, 6);
  const resultTone = totals.balance >= 0 ? "text-[#2f6b55]" : "text-[#a64f3c]";
  const metrics = [
    {
      label: tOverview("result"),
      value: totals.balance,
      icon: Scale,
      tone: resultTone,
      detail: tOverview("resultDetail"),
    },
    {
      label: t("incomePlural"),
      value: totals.incomeGross,
      icon: ArrowUpRight,
      tone: "text-[#2f6b55]",
      detail: tOverview("incomeDetail"),
    },
    {
      label: t("expensePlural"),
      value: totals.expenseGross === 0 ? 0 : -totals.expenseGross,
      icon: ReceiptText,
      tone: "text-[#17342d]",
      detail: tOverview("expenseDetail"),
    },
    {
      label: tOverview("vatPosition"),
      value: vatBalance,
      icon: Landmark,
      tone: vatBalance > 0 ? "text-[#a36525]" : "text-[#315c73]",
      detail: tOverview("vatDetail"),
    },
  ];

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-[#71807a] uppercase">
            {tOverview("period", { year })}
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[#15342c] sm:text-[2.35rem] sm:leading-tight">
            {tOverview("title")}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#65736e] sm:text-base">
            {tOverview("description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={changeYear}>
            <SelectTrigger
              className="h-9 min-w-28 border-[#d4ddd8] bg-white text-[#29463e] shadow-xs"
              aria-label={t("year")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((item) => (
                <SelectItem key={item} value={String(item)}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="h-9 bg-[#173c32] px-3.5 text-white hover:bg-[#245345]"
            onClick={() => {
              setDialogEntry(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("newEntry")}
          </Button>
        </div>
      </section>

      <section
        aria-label={tOverview("keyFigures")}
        className="grid overflow-hidden rounded-2xl border border-[#dfe5e1] bg-white shadow-[0_1px_2px_rgba(20,47,39,0.03)] sm:grid-cols-2 xl:grid-cols-4"
      >
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <article
              key={metric.label}
              className={`relative min-w-0 p-5 sm:p-6 ${
                index > 0 ? "border-t border-[#e3e8e5] sm:border-t-0 sm:border-l" : ""
              } ${index === 2 ? "sm:border-l-0 xl:border-l" : ""}`}
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold tracking-[0.08em] text-[#73817c] uppercase">
                  {metric.label}
                </p>
                <Icon className="size-4 text-[#8b9793]" />
              </div>
              <p className={`text-2xl font-semibold tracking-[-0.035em] tabular-nums ${metric.tone}`}>
                {formatCents(metric.value, locale)}
              </p>
              <p className="mt-1.5 text-xs text-[#88938f]">{metric.detail}</p>
            </article>
          );
        })}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
        <section className="rounded-2xl border border-[#dfe5e1] bg-white p-5 shadow-[0_1px_2px_rgba(20,47,39,0.03)] sm:p-6">
          <CashflowChart months={months} year={year} />
        </section>

        <aside className="overflow-hidden rounded-2xl bg-[#173c32] text-white shadow-[0_12px_30px_rgba(23,60,50,0.12)]">
          <div className="p-6 sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <span className="flex size-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
                <BookOpenText className="size-5 text-[#b9d5ca]" />
              </span>
              <span className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-[#c8d9d2] uppercase">
                {tOverview("ledgerBadge")}
              </span>
            </div>
            <h2 className="mt-8 text-xl font-semibold tracking-[-0.025em]">
              {tOverview("ledgerTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#bfd0c9]">
              {tOverview("ledgerDescription")}
            </p>
            <div className="mt-7 flex items-end justify-between border-t border-white/15 pt-5">
              <div>
                <p className="text-xs text-[#9fb7ae]">{tOverview("bookingCount")}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{entries.length}</p>
              </div>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/accounting/bookings?year=${year}`} />}
                className="border-white/20 bg-white/8 text-white hover:bg-white/14 hover:text-white"
              >
                {tOverview("openLedger")}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
          <div className="h-1.5 bg-[#c08133]" />
        </aside>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#dfe5e1] bg-white shadow-[0_1px_2px_rgba(20,47,39,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3e8e5] px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.015em] text-[#17342d]">
              {tOverview("recentTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-[#7a8782]">
              {tOverview("recentDescription")}
            </p>
          </div>
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href={`/accounting/bookings?year=${year}`} />}
            className="text-[#315c73] hover:bg-[#edf2f0] hover:text-[#234758]"
          >
            {tOverview("showAll")}
            <ArrowRight className="size-4" />
          </Button>
        </div>
        <Table>
          <TableHeader className="bg-[#f8faf8]">
            <TableRow className="border-[#e3e8e5] hover:bg-transparent">
              <TableHead className="h-9 pl-5 text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase sm:pl-6">
                {t("date")}
              </TableHead>
              <TableHead className="h-9 text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase">
                {t("description")}
              </TableHead>
              <TableHead className="hidden h-9 text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase md:table-cell">
                {t("category")}
              </TableHead>
              <TableHead className="h-9 pr-5 text-right text-[11px] font-semibold tracking-[0.08em] text-[#7b8883] uppercase sm:pr-6">
                {t("gross")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentEntries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-[#7a8782]">
                  {t("noEntries")}
                </TableCell>
              </TableRow>
            )}
            {recentEntries.map((entry) => {
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
                  <TableCell className="pl-5 text-[#68756f] sm:pl-6">
                    {format.dateTime(new Date(entry.date), {
                      day: "2-digit",
                      month: "short",
                    })}
                  </TableCell>
                  <TableCell className="max-w-80">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[#213c35]">
                          {entry.description}
                        </span>
                        {entry.counterparty && (
                          <span className="block truncate text-xs text-[#84908c]">
                            {entry.counterparty}
                          </span>
                        )}
                      </span>
                      {entry.attachmentCount > 0 && (
                        <Paperclip className="size-3.5 shrink-0 text-[#83918b]" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="inline-flex items-center gap-2 text-xs text-[#63716c]">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: entry.categoryColor }}
                      />
                      {entry.categoryName}
                    </span>
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

      <EntryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={dialogEntry}
        categories={categories}
        canManagePersonnel={canManagePersonnel}
        taxSettings={taxSettings}
        fundingProjects={fundingProjects}
        personnelEmployees={personnelEmployees}
        personnelLocations={personnelLocations}
        payrollMonthContexts={payrollMonthContexts}
      />
    </div>
  );
}
