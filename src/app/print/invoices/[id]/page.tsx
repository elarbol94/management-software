import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { getAppSettings } from "@/modules/settings/queries";
import { getInvoiceWithItems } from "@/modules/accounting/invoice-queries";
import { PrintButton } from "./print-button";

// Standalone A4 print view (§ 11 UStG mandatory fields), opened in a new tab.
export default async function InvoicePrintPage({
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

  const formatDate = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  return (
    <main className="mx-auto max-w-3xl bg-white p-10 text-sm text-black print:p-0">
      <PrintButton />

      <header className="flex items-start justify-between border-b pb-6">
        <div>
          <h1 className="text-xl font-bold">{settings.companyName}</h1>
          <p className="whitespace-pre-line text-neutral-600">
            {settings.address}
          </p>
          {settings.uid && <p className="text-neutral-600">UID: {settings.uid}</p>}
        </div>
        <div className="text-right">
          <h2 className="text-2xl font-semibold">
            {invoice.status === "canceled" ? "STORNO — " : ""}
            Rechnung {invoice.invoiceNumber}
          </h2>
          <p className="mt-1 text-neutral-600">
            {t("issueDate")}: {formatDate(invoice.issueDate)}
          </p>
          {invoice.dueDate && (
            <p className="text-neutral-600">
              {t("dueDate")}: {formatDate(invoice.dueDate)}
            </p>
          )}
        </div>
      </header>

      <section className="mt-6">
        <p className="text-xs tracking-wide text-neutral-500 uppercase">
          {t("invoiceFor")}
        </p>
        <p className="mt-1 font-medium">{customer?.name}</p>
        {customer?.address && (
          <p className="whitespace-pre-line text-neutral-600">
            {customer.address}
          </p>
        )}
        {customer?.uid && <p className="text-neutral-600">UID: {customer.uid}</p>}
      </section>

      <table className="mt-8 w-full border-collapse">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2 pr-2">{t("itemDescription")}</th>
            <th className="py-2 pr-2 text-right">{t("quantity")}</th>
            <th className="py-2 pr-2 text-right">{t("unitPrice")}</th>
            <th className="py-2 pr-2 text-right">USt</th>
            <th className="py-2 text-right">{t("lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-neutral-200">
              <td className="py-2 pr-2">{item.description}</td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {(item.quantityThousandths / 1000).toLocaleString(locale)}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {formatCents(item.unitPriceCents, locale)}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {item.vatRate} %
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatCents(
                  Math.floor(
                    (item.quantityThousandths * item.unitPriceCents) / 1000 + 0.5,
                  ),
                  locale,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-4 flex justify-end">
        <div className="flex w-64 flex-col gap-1">
          <div className="flex justify-between">
            <span>{t("subtotal")}</span>
            <span className="tabular-nums">
              {formatCents(totals.netCents, locale)}
            </span>
          </div>
          {totals.byRate
            .filter((group) => group.vatRate > 0)
            .map((group) => (
              <div key={group.vatRate} className="flex justify-between">
                <span>{t("vatAmount", { rate: group.vatRate })}</span>
                <span className="tabular-nums">
                  {formatCents(group.vatCents, locale)}
                </span>
              </div>
            ))}
          <div className="mt-1 flex justify-between border-t-2 border-black pt-1 text-base font-bold">
            <span>{t("total")}</span>
            <span className="tabular-nums">
              {formatCents(totals.grossCents, locale)}
            </span>
          </div>
        </div>
      </section>

      {settings.kleinunternehmer && (
        <p className="mt-6 text-neutral-600">{t("kleinunternehmerNote")}</p>
      )}

      {invoice.notes && (
        <p className="mt-6 whitespace-pre-line text-neutral-600">{invoice.notes}</p>
      )}

      {settings.iban && (
        <footer className="mt-10 border-t pt-4 text-neutral-600">
          {t("paymentInfo", {
            iban: settings.iban,
            bic: settings.bic || "none",
          })}
        </footer>
      )}
    </main>
  );
}
