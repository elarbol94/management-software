import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Download, ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import {
  categorySummary,
  monthlySummary,
  vatSummary,
  yearsWithEntries,
} from "@/modules/accounting/queries";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { YearSelect } from "./year-select";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const year =
    params.year && /^\d{4}$/.test(params.year)
      ? Number(params.year)
      : new Date().getFullYear();

  const t = await getTranslations("accounting");
  const locale = await getLocale();
  const format = await getFormatter();

  const months = monthlySummary(year);
  const byCategory = categorySummary(year);
  const byVat = vatSummary(year);

  const years = yearsWithEntries();
  const currentYear = new Date().getFullYear();
  if (!years.includes(currentYear)) years.unshift(currentYear);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => b - a);

  const totalIncome = months.reduce((sum, m) => sum + m.incomeGross, 0);
  const totalExpense = months.reduce((sum, m) => sum + m.expenseGross, 0);

  const vatCollected = byVat
    .filter((row) => row.kind === "income")
    .reduce((sum, row) => sum + row.vat, 0);
  const vatPaid = byVat
    .filter((row) => row.kind === "expense")
    .reduce((sum, row) => sum + row.vat, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/accounting" />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("report")} {year}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <YearSelect years={years} year={year} />
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={`/api/accounting/export?year=${year}`} />}
          >
            <Download className="size-4" />
            {t("exportCsv")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("monthlyOverview")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("month")}</TableHead>
                  <TableHead className="text-right">{t("incomePlural")}</TableHead>
                  <TableHead className="text-right">{t("expensePlural")}</TableHead>
                  <TableHead className="text-right">{t("balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((month) => {
                  const balance = month.incomeGross - month.expenseGross;
                  return (
                    <TableRow key={month.month}>
                      <TableCell>
                        {format.dateTime(new Date(year, month.month - 1, 1), {
                          month: "long",
                        })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(month.incomeGross, locale)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(month.expenseGross, locale)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          balance < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {formatCents(balance, locale)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t("sum")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(totalIncome, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(totalExpense, locale)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-semibold tabular-nums ${
                      totalIncome - totalExpense < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {formatCents(totalIncome - totalExpense, locale)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("vatSummaryTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("vatRate")}</TableHead>
                    <TableHead className="text-right">{t("vatCollected")}</TableHead>
                    <TableHead className="text-right">{t("vatPaid")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[20, 13, 10, 0].map((rate) => {
                    const collected =
                      byVat.find((r) => r.vatRate === rate && r.kind === "income")
                        ?.vat ?? 0;
                    const paid =
                      byVat.find((r) => r.vatRate === rate && r.kind === "expense")
                        ?.vat ?? 0;
                    if (rate === 0 && collected === 0 && paid === 0) return null;
                    return (
                      <TableRow key={rate}>
                        <TableCell>{rate} %</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(collected, locale)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(paid, locale)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>{t("vatBalance")}</TableCell>
                    <TableCell colSpan={2} className="text-right font-semibold tabular-nums">
                      {formatCents(vatCollected - vatPaid, locale)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("categoryBreakdown")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("category")}</TableHead>
                    <TableHead className="text-right">{t("net")}</TableHead>
                    <TableHead className="text-right">{t("gross")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byCategory.map((row) => (
                    <TableRow key={`${row.categoryId}-${row.kind}`}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{ backgroundColor: row.categoryColor }}
                          />
                          {row.categoryName}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(
                          row.kind === "expense" ? -row.net : row.net,
                          locale,
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(
                          row.kind === "expense" ? -row.gross : row.gross,
                          locale,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
