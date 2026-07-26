"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { BookMarked, Check, Clock3, History, Link2, Plus, Star, Trash2, X } from "lucide-react";
import { createPage, deletePage, renamePage } from "../actions";
import { linkSupportingSource, restorePageRevision, toggleFavorite, unlinkSupportingSource, updatePageResearchMeta } from "../research-actions";
import type { CitationSource } from "../lib/citations";
import { formatBibliographyEntry } from "../lib/citations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WikiEditor } from "./wiki-editor";
import { AttachmentPanel, type AttachmentPanelHandle } from "./attachment-panel";
import { EvidencePanel } from "./evidence-panel";
import { PageExportMenu } from "./page-export-menu";
import type { CommentThread } from "./comment-rail";
import { FocusModeToggle, useFocusMode } from "@/components/focus-mode";
import type { UserMarkColor } from "@/lib/user-mark-colors";
import type { StoredDocumentTemplate } from "../document-queries";
import type { WikiTypographySettingsV1 } from "../lib/wiki-typography";

type PageRef = { id: string; title: string; slug: string };
type SourceRef = { id: string; title: string; issuedDate: string; contributors: string };
export function WikiShell({ page, backlinks, allPages, sources, citationSources, research, comments, currentUserId, users, attachments, documentTemplates, typography, meta }: {
  page: { id: string; title: string; slug: string; contentJson: string; status: "inbox" | "working" | "evergreen"; citationLocale: string; version: number; documentMode: boolean; documentSettingsJson: string };
  backlinks: PageRef[]; allPages: PageRef[]; sources: SourceRef[]; citationSources: CitationSource[];
  research: { tags: Array<{ id: string; name: string; color: string }>; supportingSources: Array<{ id: string; title: string; issuedDate: string; relation: string }>; favorite: boolean; revisions: Array<{ id: string; version: number; kind: string; createdAt: Date; createdByName: string }> };
  comments: CommentThread[]; currentUserId: string; users: Array<{ id: string; name: string; markColor: UserMarkColor }>;
  attachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number }>;
  documentTemplates: StoredDocumentTemplate[];
  typography: WikiTypographySettingsV1;
  meta: { updatedAt: number; updatedByName: string } | null;
}) {
  const t = useTranslations("wiki"); const common = useTranslations("common"); const format = useFormatter(); const router = useRouter();
  const { isFocused } = useFocusMode();
  const [status, setStatus] = useState(page.status); const [citationLocale, setCitationLocale] = useState(page.citationLocale);
  const [tags, setTags] = useState(research.tags.map((tag) => tag.name).join(", ")); const [metaSaved, setMetaSaved] = useState(false);
  const [sourceToLink, setSourceToLink] = useState("");
  const [supportingSourceOpen, setSupportingSourceOpen] = useState(false);
  const attachmentRef = useRef<AttachmentPanelHandle>(null); const supportingSourceSectionRef = useRef<HTMLElement>(null); const supportingSourceTriggerRef = useRef<HTMLButtonElement>(null);
  const bibliography = useMemo(() => [...citationSources].sort((a, b) => formatBibliographyEntry(a).localeCompare(formatBibliographyEntry(b))), [citationSources]);

  async function saveMeta(nextStatus = status, nextLocale = citationLocale) {
    await updatePageResearchMeta({ pageId: page.id, status: nextStatus, citationLocale: nextLocale as "de-DE" | "en-US", tagNames: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
    setMetaSaved(true); setTimeout(() => setMetaSaved(false), 1600); router.refresh();
  }

  async function rename() { const title = prompt(t("pageTitle"), page.title); if (!title?.trim()) return; await renamePage(page.id, title.trim()); router.refresh(); }
  async function remove() { if (!confirm(common("confirmDeleteTitle"))) return; await deletePage(page.id); router.push("/wiki/inbox"); router.refresh(); }

  return <main className={isFocused ? "w-full max-w-none p-4 md:p-7" : "mx-auto max-w-[112rem] p-4 md:p-7"}>
    <header className="mb-5 border-b pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><button onClick={rename} className={isFocused ? "max-w-4xl text-left text-2xl font-semibold tracking-tight hover:text-indigo-700 dark:hover:text-indigo-300" : "max-w-4xl text-left text-3xl font-semibold tracking-tight hover:text-indigo-700 dark:hover:text-indigo-300"}>{page.title}</button>{!isFocused && meta && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{t("lastEdited", { name: meta.updatedByName })} · {format.dateTime(new Date(meta.updatedAt), { dateStyle: "medium", timeStyle: "short" })}</p>}</div>
        <div className="flex items-center gap-1">{!isFocused && <><Button variant="ghost" size="icon-sm" title={t("newSubpage")} onClick={async () => { const title = prompt(t("pageTitle")); if (!title?.trim()) return; const child = await createPage({ title: title.trim(), parentId: page.id }); router.push(`/wiki/pages/${child.slug}`); router.refresh(); }}><Plus className="size-4" /></Button><PageExportMenu pageId={page.id} /><Button variant={research.favorite ? "secondary" : "ghost"} size="icon-sm" title={t("favorite")} onClick={async () => { await toggleFavorite("page", page.id); router.refresh(); }}><Star className={research.favorite ? "size-4 fill-indigo-400 text-indigo-500" : "size-4"} /></Button><Button variant="ghost" size="icon-sm" title={t("deletePage")} onClick={remove}><Trash2 className="size-4 text-destructive" /></Button></>}<FocusModeToggle compact={isFocused} /></div></div>
      {!isFocused && <div data-testid="note-metadata-controls" className="mt-4 flex flex-wrap items-center gap-2"><Select value={status} onValueChange={(value) => { if (!value) return; const next = value as typeof status; setStatus(next); void saveMeta(next, citationLocale); }}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent>{["inbox","working","evergreen"].map((item) => <SelectItem key={item} value={item}>{t(`pageStatuses.${item}`)}</SelectItem>)}</SelectContent></Select>
        <Select value={citationLocale} onValueChange={(value) => { if (!value) return; setCitationLocale(value); void saveMeta(status, value); }}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="de-DE">APA · DE</SelectItem><SelectItem value="en-US">APA · EN</SelectItem></SelectContent></Select>
        <div className="flex min-w-52 flex-1 items-center gap-1"><Input value={tags} onChange={(event) => setTags(event.target.value)} onBlur={() => void saveMeta()} placeholder={t("tagsHint")} className="h-8 text-xs" />{metaSaved && <Check className="size-4 text-emerald-600" />}</div>
      </div>}
    </header>

    <div className={isFocused ? "w-full" : "grid gap-7 xl:grid-cols-[minmax(0,1fr)_17rem]"}>
      <section className="min-w-0">
        <WikiEditor key={page.id} focused={isFocused} pageId={page.id} pageVersion={page.version} initialContent={page.contentJson} initialDocumentMode={page.documentMode} initialDocumentSettings={page.documentSettingsJson} initialTypography={typography} documentTemplates={documentTemplates} allPages={allPages} sources={sources} users={users} citationLocale={citationLocale} comments={comments} currentUserId={currentUserId} pageActions={{ addAttachment: () => attachmentRef.current?.openFilePicker(), linkSupportingSource: () => { supportingSourceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); setSupportingSourceOpen(true); requestAnimationFrame(() => supportingSourceTriggerRef.current?.focus()); } }} />
        {!isFocused && bibliography.length > 0 && <section className="mt-10 border-t pt-6"><p className="mb-1 text-xs font-semibold tracking-[0.16em] text-indigo-600 uppercase">APA 7</p><h2 className="mb-4 text-xl font-semibold">{t("references")}</h2><ol className="space-y-3 text-sm leading-relaxed">{bibliography.map((source) => <li key={source.id} className="pl-6 -indent-6">{formatBibliographyEntry(source)}</li>)}</ol></section>}
        {!isFocused && backlinks.length > 0 && <section className="mt-8 border-t pt-5"><h2 className="mb-3 flex items-center gap-2 text-sm font-medium"><Link2 className="size-4 text-indigo-500" />{t("backlinks")}</h2><div className="flex flex-wrap gap-2">{backlinks.map((item) => <Link key={item.id} href={`/wiki/pages/${item.slug}`} className="rounded-md border px-2 py-1 text-sm hover:bg-accent">{item.title}</Link>)}</div></section>}
      </section>

      {!isFocused && <aside data-testid="note-metadata-sidebar" className="space-y-6 xl:border-l xl:pl-6">
        <AttachmentPanel ref={attachmentRef} entityType="wikiPage" entityId={page.id} initial={attachments} />
        <EvidencePanel targetType="wikiPage" targetId={page.id} compact />
        <section ref={supportingSourceSectionRef}><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><BookMarked className="size-4 text-indigo-500" />{t("supportingSources")}</h3><div className="flex gap-1"><Select open={supportingSourceOpen} onOpenChange={setSupportingSourceOpen} value={sourceToLink} onValueChange={(value) => setSourceToLink(value ?? "")}><SelectTrigger data-testid="supporting-source-picker" ref={supportingSourceTriggerRef} className="min-w-0 flex-1"><SelectValue placeholder={t("chooseSource")} /></SelectTrigger><SelectContent>{sources.filter((source) => !research.supportingSources.some((linked) => linked.id === source.id)).map((source) => <SelectItem key={source.id} value={source.id}>{source.title}</SelectItem>)}</SelectContent></Select><Button size="icon" variant="outline" disabled={!sourceToLink} onClick={async () => { await linkSupportingSource(page.id, sourceToLink); setSourceToLink(""); router.refresh(); }}><Plus className="size-4" /></Button></div><div className="mt-2 space-y-1">{research.supportingSources.map((source) => <div key={source.id} className="group flex items-center gap-1 rounded-md border p-2 text-xs"><Link href={`/wiki/sources/${source.id}`} className="min-w-0 flex-1 truncate font-medium">{source.title}</Link><button onClick={async () => { await unlinkSupportingSource(page.id, source.id); router.refresh(); }} className="opacity-0 group-hover:opacity-100"><X className="size-3" /></button></div>)}</div></section>
        <section><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><History className="size-4 text-indigo-500" />{t("history")}</h3><div className="max-h-52 space-y-2 overflow-y-auto">{research.revisions.map((revision) => <div key={revision.id} className="flex items-start justify-between gap-2 text-xs"><p><span className="font-medium">v{revision.version}</span> · {revision.createdByName}<br /><span className="text-muted-foreground">{format.dateTime(new Date(revision.createdAt), { dateStyle: "medium", timeStyle: "short" })}</span></p><Button size="xs" variant="ghost" onClick={async () => { if (!confirm(t("restoreRevisionConfirm"))) return; await restorePageRevision(revision.id); localStorage.removeItem(`wiki-draft:${page.id}`); location.reload(); }}>{t("restore")}</Button></div>)}</div></section>
      </aside>}
    </div>
  </main>;
}
