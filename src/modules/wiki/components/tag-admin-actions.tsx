"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { GitMerge, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mergeTags, renameTag } from "../research-actions";
export function TagAdminActions({ tag, tags }: { tag: { id: string; name: string }; tags: Array<{ id: string; name: string }> }) { const t=useTranslations("wiki"); const router=useRouter(); return <div className="flex gap-1"><Button variant="outline" size="sm" onClick={async()=>{const name=prompt(t("tagName"),tag.name);if(!name?.trim())return;await renameTag(tag.id,name);router.refresh();}}><Pencil className="size-3.5" />{t("rename")}</Button><Button variant="outline" size="sm" onClick={async()=>{const options=tags.filter((item)=>item.id!==tag.id);const name=prompt(`${t("mergeTagPrompt")}\n${options.map((item)=>item.name).join(", ")}`);const target=options.find((item)=>item.name.toLocaleLowerCase()===name?.trim().toLocaleLowerCase());if(!target)return;await mergeTags(tag.id,target.id);router.push(`/wiki/tags/${target.id}`);router.refresh();}}><GitMerge className="size-3.5" />{t("mergeTag")}</Button></div>; }
