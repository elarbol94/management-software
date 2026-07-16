import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Printer } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { getAppSettings } from "@/modules/settings/queries";
import {
  getInvoiceWithItems,
  listCustomers,
} from "@/modules/accounting/invoice-queries";
import { InvoiceEditor } from "@/modules/accounting/components/invoice-editor";
import { InvoiceStatusBadge } from "@/modules/accounting/components/invoice-status-badge";
import { InvoiceStatusActions } from "@/modules/accounting/components/invoice-status-actions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const data = getInvoiceWithItems(id);
  if (!data) notFound();
  const { invoice, customer, items, totals } = data;

  const t = await getTranslations("invoices");
  const locale = await getLocale();
  const format = await getFormatter();
  const settings = getAppSettings();
  const customers = listCustomers();

  const isDraft = invoice.status === "draft";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/accounting/invoices" />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {invoice.invoiceNumber}
        </h1>
        <InvoiceStatusBadge status={invoice.status} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={`/print/invoices/${invoice.id}`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <Printer className="size-4" />
            {t("print")}
          </Button>
          <InvoiceStatusActions id={invoice.id} status={invoice.status} />
        </div>
      </div>

      {isDraft ? (
        <InvoiceEditor
          customers={customers}
          initial={{
            id: invoice.id,
            customerId: invoice.customerId,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            notes: invoice.notes,
            items,
          }}
          defaultVatRate={settings.kleinunternehmer ? 0 : settings.defaultVatRate}
        />
      ) : (
        <div className="flex max-w-3xl flex-col gap-6">
          <p className="text-sm text-muted-foreground">{t("editOnlyDraft")}</p>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">{t("customer")}</p>
              <p className="font-medium">{customer?.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("issueDate")}</p>
              <p className="font-medium">
                {format.dateTime(new Date(invoice.issueDate), {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
            </div>
            {invoice.dueDate && (
              <div>
                <p className="text-muted-foreground">{t("dueDate")}</p>
                <p className="font-medium">
                  {format.dateTime(new Date(invoice.dueDate), {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </p>
              </div>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("itemDescription")}</TableHead>
                <TableHead className="text-right">{t("quantity")}</TableHead>
                <TableHead className="text-right">{t("unitPrice")}</TableHead>
                <TableHead className="text-right">USt</TableHead>
                <TableHead className="text-right">{t("lineTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(item.quantityThousandths / 1000).toLocaleString(locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(item.unitPriceCents, locale)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.vatRate} %
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(
                      Math.floor(
                        (item.quantityThousandths * item.unitPriceCents) / 1000 + 0.5,
                      ),
                      locale,
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex flex-col items-end gap-1 text-sm">
            <span>
              {t("subtotal")}:{" "}
              <span className="tabular-nums">
                {formatCents(totals.netCents, locale)}
              </span>
            </span>
            {totals.byRate
              .filter((group) => group.vatRate > 0)
              .map((group) => (
                <span key={group.vatRate}>
                  {t("vatAmount", { rate: group.vatRate })}:{" "}
                  <span className="tabular-nums">
                    {formatCents(group.vatCents, locale)}
                  </span>
                </span>
              ))}
            <span className="text-base font-semibold">
              {t("total")}:{" "}
              <span className="tabular-nums">
                {formatCents(totals.grossCents, locale)}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
