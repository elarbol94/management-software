"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useTranslations("wiki");
  return (
    // Fixed rather than in flow: a button between the pages would push the first one
    // off its sheet even though printing hides it.
    <div className="fixed top-4 right-4 z-10 print:hidden">
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="size-4" />
        {t("presentations.exportPdf")}
      </Button>
    </div>
  );
}
