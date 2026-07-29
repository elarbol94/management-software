"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveSource } from "../research-actions";

type InitialSource = Partial<{
  id: string; documentType?: string; type: "journalArticle" | "book" | "bookChapter" | "report" | "webPage" | "document";
  title: string; subtitle: string; issuedDate: string; containerTitle: string; publisher: string; institution: string;
  edition: string; volume: string; issue: string; pages: string; doi: string; isbn: string; url: string; accessedAt: string;
  language: string; abstract: string; notes: string; readingStatus: "toRead" | "reading" | "read";
  contributors: Array<{ role: "author" | "editor"; given: string; family: string; literal: string }>;
  tags: Array<{ name: string }>;
}>;

function contributorLines(initial?: InitialSource) {
  return (initial?.contributors ?? []).map((person) => person.literal ? `@${person.literal}` : `${person.family}, ${person.given}`).join("\n");
}

export function SourceForm({ initial: initialSource, documentTypes = [], compact = false, redirectTo, onSaved }: { initial?: InitialSource; documentTypes?: string[]; compact?: boolean; redirectTo?: string; onSaved?: () => void }) {
  const t = useTranslations("wiki"); const router = useRouter();
  // Base UI inputs are uncontrolled. Keep their defaults stable when a server refresh updates PDF-derived metadata.
  const [initial] = useState(initialSource);
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const [type, setType] = useState(initial?.type ?? "document");
  const [readingStatus, setReadingStatus] = useState(initial?.readingStatus ?? "toRead");
  const sourceTypeId = useId();
  const readingStatusId = useId();

  async function submit(formData: FormData) {
    setPending(true); setError("");
    const value = (name: string) => String(formData.get(name) ?? "").trim();
    const contributors = value("contributors").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      if (line.startsWith("@")) return { role: "author" as const, given: "", family: "", literal: line.slice(1).trim() };
      const [family, ...given] = line.split(",");
      return { role: "author" as const, family: family.trim(), given: given.join(",").trim(), literal: "" };
    });
    try {
      const result = await saveSource({ id: initial?.id, type, documentType: value("documentType"), readingStatus, contributors,
        title: value("title"), subtitle: value("subtitle"), issuedDate: value("issuedDate"), containerTitle: value("containerTitle"),
        publisher: value("publisher"), institution: value("institution"), edition: value("edition"), volume: value("volume"), issue: value("issue"), pages: value("pages"),
        doi: value("doi"), isbn: value("isbn"), url: value("url"), accessedAt: value("accessedAt"), language: value("language"), abstract: value("abstract"), notes: value("notes"),
        tagNames: value("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      if (!result.ok) { setError(t("duplicateSource", { title: result.duplicate.title })); return; }
      onSaved?.(); router.push(redirectTo ?? `/wiki/sources/${result.id}`); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("saveFailed")); }
    finally { setPending(false); }
  }

  return <form action={submit} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.requestSubmit(); } }} className="space-y-5">
      {error && <div role="alert" aria-live="polite" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    <div className="grid gap-4 md:grid-cols-4">
      <div className="space-y-1.5"><Label htmlFor={sourceTypeId}>{t("sourceType")}</Label><Select value={type} onValueChange={(value) => setType(value as typeof type)}><SelectTrigger id={sourceTypeId} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["journalArticle","book","bookChapter","report","webPage","document"].map((item) => <SelectItem key={item} value={item}>{t(`sourceTypes.${item}`)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="documentType">{t("documentType")}</Label><Input id="documentType" name="documentType" list="document-types" defaultValue={initial?.documentType} placeholder={t("documentTypePlaceholder")} /><datalist id="document-types">{documentTypes.map((item) => <option key={item} value={item} />)}</datalist></div>
      <div className="space-y-1.5"><Label htmlFor={readingStatusId}>{t("readingStatus")}</Label><Select value={readingStatus} onValueChange={(value) => setReadingStatus(value as typeof readingStatus)}><SelectTrigger id={readingStatusId} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["toRead","reading","read"].map((item) => <SelectItem key={item} value={item}>{t(`readingStatuses.${item}`)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="issuedDate">{t("issuedDate")}</Label><Input id="issuedDate" name="issuedDate" defaultValue={initial?.issuedDate} placeholder="2026 or 2026-07-20" /></div>
    </div>
    <div className="grid gap-4 md:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="title">{t("sourceTitle")}</Label><Input id="title" name="title" required defaultValue={initial?.title} /></div><div className="space-y-1.5"><Label htmlFor="subtitle">{t("subtitle")}</Label><Input id="subtitle" name="subtitle" defaultValue={initial?.subtitle} /></div></div>
    <div className="space-y-1.5"><Label htmlFor="contributors">{t("contributors")}</Label><Textarea id="contributors" name="contributors" rows={3} defaultValue={contributorLines(initial)} placeholder={t("contributorsHint")} /><p className="text-xs text-muted-foreground">{t("contributorsHelp")}</p></div>
    <div className="grid gap-4 md:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="containerTitle">{t("containerTitle")}</Label><Input id="containerTitle" name="containerTitle" defaultValue={initial?.containerTitle} /></div><div className="space-y-1.5"><Label htmlFor="publisher">{t("publisher")}</Label><Input id="publisher" name="publisher" defaultValue={initial?.publisher} /></div></div>
    {!compact && <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5"><Field name="institution" label={t("institution")} value={initial?.institution} /><Field name="edition" label={t("edition")} value={initial?.edition} /><Field name="volume" label={t("volume")} value={initial?.volume} /><Field name="issue" label={t("issue")} value={initial?.issue} /><Field name="pages" label={t("pageRange")} value={initial?.pages} /></div>
      <div className="grid gap-4 md:grid-cols-3"><Field name="doi" label="DOI" value={initial?.doi} /><Field name="isbn" label="ISBN" value={initial?.isbn} /><Field name="language" label={t("language")} value={initial?.language} /></div>
      <div className="grid gap-4 md:grid-cols-[1fr_12rem]"><Field name="url" label="URL" value={initial?.url} /><Field name="accessedAt" label={t("accessedAt")} value={initial?.accessedAt} type="date" /></div>
      <div className="space-y-1.5"><Label htmlFor="abstract">{t("abstract")}</Label><Textarea id="abstract" name="abstract" rows={4} defaultValue={initial?.abstract} /></div>
      <div className="space-y-1.5"><Label htmlFor="notes">{t("sourceNotes")}</Label><Textarea id="notes" name="notes" rows={4} defaultValue={initial?.notes} /></div>
    </>}
    <div className="space-y-1.5"><Label htmlFor="tags">{t("tags")}</Label><Input id="tags" name="tags" defaultValue={(initial?.tags ?? []).map((tag) => tag.name).join(", ")} placeholder={t("tagsHint")} /></div>
    <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? <Loader2 className="size-4 animate-spin" /> : initial?.id ? <Save className="size-4" /> : <Plus className="size-4" />}{initial?.id ? t("saveSource") : t("createSource")}</Button></div>
  </form>;
}

function Field({ name, label, value, type = "text" }: { name: string; label: string; value?: string; type?: string }) {
  return <div className="space-y-1.5"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} defaultValue={value} /></div>;
}
