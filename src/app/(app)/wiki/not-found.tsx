import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function WikiNotFound() {
  const t = await getTranslations("wiki");
  return <div className="mx-auto max-w-4xl p-5 md:p-8">
    <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/20 text-center">
      <div>
        <FileQuestion className="mx-auto mb-3 size-8 text-indigo-400" />
        <h1 className="font-medium">{t("notFoundTitle")}</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("notFoundDescription")}</p>
        <div className="mt-4 flex justify-center">
          <Button render={<Link href="/wiki" />}>{t("backToWikiStart")}</Button>
        </div>
      </div>
    </div>
  </div>;
}
