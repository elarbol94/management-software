import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

const VARIANTS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  paid: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  canceled: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const t = useTranslations("invoices");
  const label = {
    draft: t("statusDraft"),
    sent: t("statusSent"),
    paid: t("statusPaid"),
    canceled: t("statusCanceled"),
  }[status];

  return (
    <Badge className={`${VARIANTS[status] ?? ""} border-transparent`}>
      {label ?? status}
    </Badge>
  );
}
