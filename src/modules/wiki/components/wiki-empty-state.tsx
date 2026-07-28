"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BookOpen, Plus } from "lucide-react";
import { createPage } from "@/modules/wiki/actions";
import { Button } from "@/components/ui/button";

export function WikiEmptyState() {
  const t = useTranslations("wiki");
  const locale = useLocale();
  const router = useRouter();

  async function onCreate() {
    const title = window.prompt(t("pageTitle"));
    if (!title?.trim()) return;
    const { slug } = await createPage({ title: title.trim(), parentId: null, proofingLanguage: locale === "en" ? "en-US" : "de-DE" });
    router.push(`/wiki/${slug}`);
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
      <BookOpen className="size-10 text-muted-foreground" />
      <p className="text-muted-foreground">{t("noPages")}</p>
      <Button onClick={onCreate}>
        <Plus className="size-4" />
        {t("createFirst")}
      </Button>
    </div>
  );
}
