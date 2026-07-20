"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCheck, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNotificationsRead, purgeFromTrash, restoreFromTrash } from "../research-actions";
export function TrashActions({ entityType, id, canPurge }: { entityType: "page" | "source"; id: string; canPurge: boolean }) { const t = useTranslations("wiki"); const router = useRouter(); return <div className="flex gap-1"><Button size="sm" variant="outline" onClick={async () => { await restoreFromTrash(entityType, id); router.refresh(); }}><RotateCcw className="size-3.5" />{t("restore")}</Button>{canPurge && <Button size="sm" variant="ghost" onClick={async () => { if (!confirm(t("purgeConfirm"))) return; try { await purgeFromTrash(entityType, id); router.refresh(); } catch (error) { alert(error instanceof Error ? error.message : t("purgeFailed")); } }}><Trash2 className="size-3.5 text-destructive" />{t("purge")}</Button>}</div>; }
export function MarkAllReadButton() { const t = useTranslations("wiki"); const router = useRouter(); return <Button variant="outline" onClick={async () => { await markNotificationsRead(); router.refresh(); }}><CheckCheck className="size-4" />{t("markAllRead")}</Button>; }
