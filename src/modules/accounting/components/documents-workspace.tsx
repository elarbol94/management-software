import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  FileText,
  Paperclip,
  Plus,
  Upload,
  Users,
} from "@/components/server-safe-icons";
import { formatCents } from "@/lib/money";
import { listInvoices } from "@/modules/accounting/invoice-queries";
import { listReceiptDocuments } from "@/modules/accounting/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceStatusBadge } from "./invoice-status-badge";

function formatFileSize(bytes: number, locale: string) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
}

export async function DocumentsWorkspace() {
  const [t, tInvoices, tAccounting] = await Promise.all([
    getTranslations("documents"),
    getTranslations("invoices"),
    getTranslations("accounting"),
  ]);
  const locale = await getLocale();
  const format = await getFormatter();
  const invoices = listInvoices();
  const receipts = listReceiptDocuments();
  const today = new Date().toISOString().slice(0, 10);

  const drafts = invoices.filter((invoice) => invoice.status === "draft");
  const openInvoices = invoices.filter((invoice) => invoice.status === "sent");
  const overdue = openInvoices.filter(
    (invoice) => invoice.dueDate && invoice.dueDate < today,
  );
  const outstandingCents = openInvoices.reduce(
    (sum, invoice) => sum + invoice.grossCents,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <span className="h-px w-8 bg-border" />
            {t("workStatus")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/accounting?new=expense" />}
          >
            <Upload className="size-4" />
            {t("captureReceipt")}
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/accounting/invoices/new" />}
          >
            <Plus className="size-4" />
            {tInvoices("newInvoice")}
          </Button>
        </div>
      </header>

      <section
        className="grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 xl:grid-cols-4"
        aria-label={t("workStatus")}
      >
        <div className="border-b p-4 sm:border-r xl:border-b-0">
          <p className="text-xs font-medium text-muted-foreground">{t("drafts")}</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{drafts.length}</p>
        </div>
        <div className="border-b p-4 xl:border-b-0 xl:border-r">
          <p className="text-xs font-medium text-muted-foreground">
            {t("openInvoices")}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatCents(outstandingCents, locale)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("outstanding", { count: openInvoices.length })}
          </p>
        </div>
        <div className="border-b p-4 sm:border-b-0 sm:border-r">
          <p className="text-xs font-medium text-muted-foreground">{t("overdue")}</p>
          <p
            className={`mt-2 text-2xl font-semibold tabular-nums ${
              overdue.length > 0 ? "text-destructive" : ""
            }`}
          >
            {overdue.length}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs font-medium text-muted-foreground">
            {t("receiptCount")}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{receipts.length}</p>
        </div>
      </section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
            <div>
              <h2 className="font-semibold">{t("invoiceSection")}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("invoiceSectionDescription")}
              </p>
            </div>
            <Button
              className="ml-auto"
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/accounting/customers" />}
            >
              <Users className="size-4" />
              {tInvoices("customers")}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tInvoices("invoiceNumber")}</TableHead>
                  <TableHead>{tInvoices("customer")}</TableHead>
                  <TableHead>{tInvoices("dueDate")}</TableHead>
                  <TableHead>{tInvoices("status")}</TableHead>
                  <TableHead className="text-right">{tInvoices("total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-40 text-center">
                      <FileText className="mx-auto mb-3 size-7 text-muted-foreground/60" />
                      <p className="text-sm font-medium">{tInvoices("noInvoices")}</p>
                      <Button
                        className="mt-4"
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href="/accounting/invoices/new" />}
                      >
                        <Plus className="size-4" />
                        {tInvoices("newInvoice")}
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id} className="relative">
                    <TableCell className="font-medium">
                      <Link
                        href={`/accounting/invoices/${invoice.id}`}
                        className="after:absolute after:inset-0 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{invoice.customerName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {invoice.dueDate
                        ? format.dateTime(new Date(invoice.dueDate), {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "–"}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={invoice.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCents(invoice.grossCents, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">{t("receiptSection")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("receiptSectionDescription")}
            </p>
          </div>

          {receipts.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 py-10 text-center">
              <Paperclip className="mb-3 size-7 text-muted-foreground/60" />
              <p className="text-sm font-medium">{t("noReceipts")}</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                {t("noReceiptsHint")}
              </p>
              <Button
                className="mt-4"
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/accounting?new=expense" />}
              >
                <Upload className="size-4" />
                {t("captureReceipt")}
              </Button>
            </div>
          ) : (
            <ul className="divide-y">
              {receipts.map((receipt) => (
                <li key={receipt.id} className="group p-4 transition-colors hover:bg-muted/40">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                      <Paperclip className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <a
                        href={`/api/files/${receipt.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full items-center gap-1 font-medium hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                        aria-label={t("receiptFor", { description: receipt.description })}
                      >
                        <span className="truncate">{receipt.fileName}</span>
                        <ArrowRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {receipt.counterparty || receipt.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {format.dateTime(new Date(receipt.entryDate), {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </span>
                        <span aria-hidden>·</span>
                        <span>{receipt.categoryName}</span>
                        <span aria-hidden>·</span>
                        <span title={t("fileSize")}>
                          {formatFileSize(receipt.sizeBytes, locale)}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        {formatCents(receipt.grossAmountCents, locale)}
                      </span>
                      <Badge variant="outline" className="font-normal">
                        {receipt.entryKind === "income"
                          ? tAccounting("income")
                          : tAccounting("expense")}
                      </Badge>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
