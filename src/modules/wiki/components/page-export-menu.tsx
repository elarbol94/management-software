"use client";
import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export function PageExportMenu({ pageId }: { pageId: string }) { const t=useTranslations("wiki"); return <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title={t("exportPage")} />}><Download className="size-4" /></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem render={<a href={`/api/wiki/pages/${pageId}/export?format=markdown`} />}>Markdown</DropdownMenuItem><DropdownMenuItem render={<a href={`/api/wiki/pages/${pageId}/export?format=html`} />}>HTML</DropdownMenuItem></DropdownMenuContent></DropdownMenu>; }
