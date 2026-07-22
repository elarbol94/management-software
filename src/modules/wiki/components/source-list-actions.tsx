"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EllipsisVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteSource } from "../research-actions";

export function SourceListActions({ sourceId }: { sourceId: string }) {
  const t = useTranslations("wiki");
  const router = useRouter();
  async function handleDelete() {
    if (!confirm(t("deleteSourceConfirm"))) return;
    await deleteSource(sourceId);
    router.refresh();
  }
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("sourceActionsMenu")} />}><EllipsisVertical className="size-4" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem render={<Link href={`/wiki/sources/${sourceId}`} />}><Pencil />{t("edit")}</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={handleDelete}><Trash2 />{t("delete")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
