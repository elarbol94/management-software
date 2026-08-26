"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WikiError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("wiki");
  const common = useTranslations("common");
  return <div className="mx-auto max-w-4xl p-5 md:p-8">
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/20 text-center">
      <div>
        <AlertTriangle className="mx-auto mb-3 size-8 text-amber-500" />
        <h1 className="font-medium">{common("error")}</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("errorDescription")}</p>
        {error.digest && <p className="mt-2 font-mono text-[11px] text-muted-foreground">{error.digest}</p>}
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={reset}>{t("retry")}</Button>
          <Button variant="outline" render={<Link href="/wiki" />}>{t("backToWikiStart")}</Button>
        </div>
      </div>
    </div>
  </div>;
}
