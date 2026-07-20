"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { restoreSourceRevision } from "../research-actions";
export function RestoreSourceRevisionButton({ revisionId }: { revisionId: string }) { const t=useTranslations("wiki"); const router=useRouter(); return <Button size="xs" variant="ghost" onClick={async()=>{if(!confirm(t("restoreRevisionConfirm")))return;await restoreSourceRevision(revisionId);router.refresh();}}>{t("restore")}</Button>; }
