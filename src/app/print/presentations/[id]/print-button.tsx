"use client";

import { Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function PrintButton({ includeNotes }: { includeNotes: boolean }) {
  const t = useTranslations("wiki");
  return (
    // Fixed rather than in flow: a button between the pages would push the first one
    // off its sheet even though printing hides it.
    <div className="fixed top-4 right-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-white p-2 text-black print:hidden">
      <Link href={includeNotes ? "?" : "?notes=1"} className="text-sm underline underline-offset-4">
        {t(includeNotes ? "presentations.hidePrintNotes" : "presentations.includePrintNotes")}
      </Link>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="size-4" />
        {t("presentations.exportPdf")}
      </Button>
    </div>
  );
}
