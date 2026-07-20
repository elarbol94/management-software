"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteSource, toggleFavorite } from "../research-actions";
export function SourcePageActions({ sourceId }: { sourceId: string }) { const t = useTranslations("wiki"); const router = useRouter(); return <div className="flex gap-1"><Button variant="ghost" size="icon-sm" title={t("favorite")} onClick={async () => { await toggleFavorite("source", sourceId); router.refresh(); }}><Star className="size-4" /></Button><Button variant="ghost" size="icon-sm" title={t("deleteSource")} onClick={async () => { if (!confirm(t("deleteSourceConfirm"))) return; await deleteSource(sourceId); router.push("/wiki/sources"); router.refresh(); }}><Trash2 className="size-4 text-destructive" /></Button></div>; }
