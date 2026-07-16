"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useTranslations("invoices");
  return (
    <div className="mb-6 flex justify-end print:hidden">
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="size-4" />
        {t("print")}
      </Button>
    </div>
  );
}
