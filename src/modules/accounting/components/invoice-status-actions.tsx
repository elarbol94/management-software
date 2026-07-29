"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Check, Send } from "lucide-react";
import { setInvoiceStatus } from "@/modules/accounting/invoice-actions";
import { Button } from "@/components/ui/button";

export function InvoiceStatusActions({
  id,
  status,
}: {
  id: string;
  status: "draft" | "sent" | "paid" | "canceled";
}) {
  const t = useTranslations("invoices");
  const tCommon = useTranslations("common");
  const [pending, setPending] = useState(false);

  async function transition(next: "sent" | "paid" | "canceled") {
    setPending(true);
    try {
      await setInvoiceStatus(id, next);
      toast.success(tCommon("saved"));
      window.location.reload();
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status === "draft" && (
        <Button size="sm" disabled={pending} onClick={() => transition("sent")}>
          <Send className="size-4" />
          {t("markSent")}
        </Button>
      )}
      {status === "sent" && (
        <Button
          size="sm"
          disabled={pending}
          title={t("markPaidHint")}
          onClick={() => transition("paid")}
        >
          <Check className="size-4" />
          {t("markPaid")}
        </Button>
      )}
      {(status === "draft" || status === "sent") && (
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() => transition("canceled")}
        >
          <Ban className="size-4" />
          {t("cancel")}
        </Button>
      )}
    </div>
  );
}
