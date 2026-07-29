"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export function SourceFilters({ initialQuery, initialStatus }: { initialQuery: string; initialStatus: string }) {
  const t = useTranslations("wiki"); const router = useRouter(); const [query, setQuery] = useState(initialQuery); const [status, setStatus] = useState(initialStatus || "all");
  function apply(nextQuery = query, nextStatus = status) { const params = new URLSearchParams(); if (nextQuery.trim()) params.set("q", nextQuery.trim()); if (nextStatus !== "all") params.set("status", nextStatus); router.push(`/wiki/sources${params.size ? `?${params}` : ""}`); }
  return <div className="flex flex-wrap gap-2"><div className="relative min-w-64 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label={t("searchSources")} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") apply(); }} placeholder={t("searchSources")} className="pl-9" /></div><Select value={status} onValueChange={(value) => { const nextStatus = value ?? "all"; setStatus(nextStatus); apply(query, nextStatus); }}><SelectTrigger aria-label={t("readingStatus")} className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("allReadingStatuses")}</SelectItem>{["toRead","reading","read"].map((item) => <SelectItem value={item} key={item}>{t(`readingStatuses.${item}`)}</SelectItem>)}</SelectContent></Select></div>;
}
