"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createQuickNote } from "../research-actions";

export function QuickNoteButton() {
  const t = useTranslations("wiki"); const locale = useLocale(); const router = useRouter(); const [pending, setPending] = useState(false);
  return <Button disabled={pending} onClick={async () => { setPending(true); try { const page = await createQuickNote(locale === "en" ? "en" : "de"); router.push(`/wiki/pages/${page.slug}`); router.refresh(); } finally { setPending(false); } }}><Plus className="size-4" />{t("quickNote")}</Button>;
}
