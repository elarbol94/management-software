import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Plus, Users } from "@/components/server-safe-icons";
import { requireUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { listInvoices } from "@/modules/accounting/invoice-queries";
import { InvoiceStatusBadge } from "@/modules/accounting/components/invoice-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function InvoicesPage() {
  await requireUser();
  const t = await getTranslations("invoices");
  const locale = await getLocale();
  const format = await getFormatter();
  const invoices = listInvoices();

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
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/accounting/customers" />}
          >
            <Users className="size-4" />
            {t("customers")}
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href="/accounting/invoices/new" />}
          >
            <Plus className="size-4" />
            {t("newInvoice")}
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("invoiceNumber")}</TableHead>
              <TableHead>{t("customer")}</TableHead>
              <TableHead>{t("issueDate")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="text-right">{t("total")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("noInvoices")}
                </TableCell>
              </TableRow>
            )}
            {invoices.map((invoice) => (
              <TableRow key={invoice.id} className="relative">
                <TableCell className="font-medium">
                  <Link
                    href={`/accounting/invoices/${invoice.id}`}
                    className="after:absolute after:inset-0"
                  >
                    {invoice.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell>{invoice.customerName}</TableCell>
                <TableCell>
                  {format.dateTime(new Date(invoice.issueDate), {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
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
    </div>
  );
}
