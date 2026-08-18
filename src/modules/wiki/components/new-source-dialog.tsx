"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
const SourceForm = dynamic(() =>
  import("./source-form").then((module) => module.SourceForm),
);
export function NewSourceDialog({ documentTypes = [], compactButton = false, redirectTo, label }: { documentTypes?: string[]; compactButton?: boolean; redirectTo?: string; label?: string }) { const t = useTranslations("wiki"); const [open, setOpen] = useState(false); return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button variant={compactButton ? "outline" : "default"} size={compactButton ? "sm" : "default"}><Plus className="size-4" />{label ?? t("newSource")}</Button>} /><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{t("newSource")}</DialogTitle></DialogHeader>{open && <SourceForm documentTypes={documentTypes} compact redirectTo={redirectTo} onSaved={() => setOpen(false)} />}</DialogContent></Dialog>; }
