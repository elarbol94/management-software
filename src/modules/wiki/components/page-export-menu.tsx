"use client";
import { useTranslations } from "next-intl";
import { Download, Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export function PageExportMenu({ pageId }: { pageId: string }) {
  const t = useTranslations("wiki");
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title={t("exportPage")} aria-label={t("exportPage")} />}>
      <Download className="size-4" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-52">
      <DropdownMenuItem render={<a href={`/api/wiki/pages/${pageId}/export?format=pdf&disposition=inline`} target="_blank" rel="noreferrer" />}>
        <Eye />{t("document.previewPdf")}
      </DropdownMenuItem>
      <DropdownMenuItem render={<a href={`/api/wiki/pages/${pageId}/export?format=pdf`} />}>
        <FileText />{t("document.downloadPdf")}
      </DropdownMenuItem>
      <DropdownMenuItem render={<a href={`/api/wiki/pages/${pageId}/export?format=markdown`} />}>Markdown</DropdownMenuItem>
      <DropdownMenuItem render={<a href={`/api/wiki/pages/${pageId}/export?format=html`} />}>HTML</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
