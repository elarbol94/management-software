"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { BookMarked, Check, Clock3, History, Link2, Plus, Star, Trash2, X } from "lucide-react";
import { createPage, deletePage, renamePage } from "../actions";
import { createPageCheckpoint, linkSupportingSource, restorePageRevision, toggleFavorite, unlinkSupportingSource, updatePageResearchMeta } from "../research-actions";
import type { CitationSource } from "../lib/citations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WikiEditor } from "./wiki-editor";
import { AttachmentPanel, type AttachmentPanelHandle } from "./attachment-panel";
import { EvidencePanel } from "./evidence-panel";
import { PageExportMenu } from "./page-export-menu";
import type { CommentThread } from "./comment-rail";
import { FocusModeToggle, useFocusMode } from "@/components/focus-mode";
import type { UserMarkColor } from "@/lib/user-mark-colors";
import type { StoredDocumentTemplate } from "../document-queries";
import type { WikiTypographySettingsV1, WikiTypographyTemplate } from "../lib/wiki-typography";
import { extractText, parseStoredDocument } from "../lib/tiptap";
import { RevisionDiffView } from "./revision-diff-view";
import type { ContextDeadlineMarker, ContextTaskMarker } from "@/modules/tasks/types";
import { ContextPanel } from "@/modules/context/components/context-panel";

type PageRef = { id: string; title: string; slug: string };
type SourceRef = CitationSource;
export function WikiShell({ page, backlinks, allPages, sources, research, comments, currentUserId, users, attachments, documentTemplates, typography, editableTypography, typographyTemplates, tasks, deadlines, focusTaskId, focusDeadlineId, meta }: {
  page: { id: string; title: string; slug: string; contentJson: string; status: "inbox" | "working" | "evergreen"; citationLocale: string; proofingLanguage: "de-DE" | "en-US"; version: number; contentVersion: number; documentMode: boolean; documentSettingsJson: string; createdBy: string };
  backlinks: PageRef[]; allPages: PageRef[]; sources: SourceRef[];
  research: { tags: Array<{ id: string; name: string; color: string }>; supportingSources: Array<{ id: string; title: string; issuedDate: string; relation: string }>; favorite: boolean; revisions: Array<{ id: string; version: number; contentVersion: number; contentHash: string; label: string | null; kind: string; createdAt: Date; createdByName: string; contentJson: string }> };
  comments: CommentThread[]; currentUserId: string; users: Array<{ id: string; name: string; markColor: UserMarkColor }>;
  attachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number }>;
  documentTemplates: StoredDocumentTemplate[];
  typography: WikiTypographySettingsV1;
  editableTypography: WikiTypographySettingsV1;
  typographyTemplates: WikiTypographyTemplate[];
  tasks: ContextTaskMarker[];
  deadlines: ContextDeadlineMarker[];
  focusTaskId?: string;
  focusDeadlineId?: string;
  meta: { updatedAt: number; updatedByName: string } | null;
}) {
  const t = useTranslations("wiki"); const common = useTranslations("common"); const format = useFormatter(); const locale = useLocale(); const router = useRouter();
  const { isFocused } = useFocusMode();
  const [status, setStatus] = useState(page.status); const [citationLocale, setCitationLocale] = useState(page.citationLocale);
  const [tags, setTags] = useState(research.tags.map((tag) => tag.name).join(", ")); const [metaSaved, setMetaSaved] = useState(false);
  const [sourceToLink, setSourceToLink] = useState("");
  const [supportingSourceOpen, setSupportingSourceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState(research.revisions[0]?.id ?? "");
  const attachmentRef = useRef<AttachmentPanelHandle>(null); const supportingSourceSectionRef = useRef<HTMLElement>(null); const supportingSourceTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedRevision = research.revisions.find((revision) => revision.id === selectedRevisionId) ?? research.revisions[0];
  const currentText = extractText(parseStoredDocument(page.contentJson));
  const revisionText = selectedRevision ? extractText(parseStoredDocument(selectedRevision.contentJson)) : "";

  async function saveMeta(nextStatus = status, nextLocale = citationLocale) {
    await updatePageResearchMeta({ pageId: page.id, status: nextStatus, citationLocale: nextLocale as "de-DE" | "en-US", tagNames: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
    setMetaSaved(true); setTimeout(() => setMetaSaved(false), 1600); router.refresh();
  }

  async function rename() { const title = prompt(t("pageTitle"), page.title); if (!title?.trim()) return; await renamePage(page.id, title.trim()); router.refresh(); }
  async function remove() { if (!confirm(common("confirmDeleteTitle"))) return; await deletePage(page.id); router.push("/wiki/inbox"); router.refresh(); }

  return <div className={isFocused ? "w-full max-w-none p-4 md:p-7" : "mx-auto max-w-[112rem] p-4 md:p-7"}>
    <header className="mb-5 border-b pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><button type="button" aria-label={`${t("rename")}: ${page.title}`} onClick={rename} className={isFocused ? "max-w-4xl text-left text-2xl font-semibold tracking-tight hover:text-indigo-700 dark:hover:text-indigo-300" : "max-w-4xl text-left text-3xl font-semibold tracking-tight hover:text-indigo-700 dark:hover:text-indigo-300"}>{page.title}</button>{!isFocused && meta && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{t("lastEdited", { name: meta.updatedByName })} · {format.dateTime(new Date(meta.updatedAt), { dateStyle: "medium", timeStyle: "short" })}</p>}</div>
        <div className="flex items-center gap-1">{!isFocused && <><Button variant="ghost" size="icon-sm" title={t("newSubpage")} aria-label={t("newSubpage")} onClick={async () => { const title = prompt(t("pageTitle")); if (!title?.trim()) return; const child = await createPage({ title: title.trim(), parentId: page.id, proofingLanguage: locale === "en" ? "en-US" : "de-DE" }); router.push(`/wiki/pages/${child.slug}`); router.refresh(); }}><Plus className="size-4" /></Button><PageExportMenu pageId={page.id} /><Button variant={research.favorite ? "secondary" : "ghost"} size="icon-sm" title={t("favorite")} aria-label={t("favorite")} aria-pressed={research.favorite} onClick={async () => { await toggleFavorite("page", page.id); router.refresh(); }}><Star className={research.favorite ? "size-4 fill-indigo-400 text-indigo-500" : "size-4"} /></Button><Button variant="ghost" size="icon-sm" title={t("deletePage")} aria-label={t("deletePage")} onClick={remove}><Trash2 className="size-4 text-destructive" /></Button></>}<FocusModeToggle compact={isFocused} /></div></div>
    </header>

    <div className={isFocused ? "w-full" : "grid gap-7 xl:grid-cols-[minmax(0,1fr)_17rem]"}>
      <section className="min-w-0">
        <WikiEditor key={page.id} focused={isFocused} pageId={page.id} pageTitle={page.title} pageSlug={page.slug} pageVersion={page.version} pageContentVersion={page.contentVersion} initialContent={page.contentJson} initialProofingLanguage={page.proofingLanguage} initialDocumentMode={page.documentMode} initialDocumentSettings={page.documentSettingsJson} initialTypography={typography} editableTypography={editableTypography} typographyTemplates={typographyTemplates} isPrimaryAuthor={page.createdBy === currentUserId} documentTemplates={documentTemplates} allPages={allPages} sources={sources} users={users} citationLocale={citationLocale} comments={comments} contextTasks={tasks} contextDeadlines={deadlines} focusTaskId={focusTaskId} focusDeadlineId={focusDeadlineId} currentUserId={currentUserId} pageActions={{ addAttachment: () => attachmentRef.current?.openFilePicker(), linkSupportingSource: () => { supportingSourceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); setSupportingSourceOpen(true); requestAnimationFrame(() => supportingSourceTriggerRef.current?.focus()); } }} />
        {!isFocused && backlinks.length > 0 && <section className="mt-8 border-t pt-5"><h2 className="mb-3 flex items-center gap-2 text-sm font-medium"><Link2 className="size-4 text-indigo-500" />{t("backlinks")}</h2><div className="flex flex-wrap gap-2">{backlinks.map((item) => <Link key={item.id} href={`/wiki/pages/${item.slug}`} className="rounded-md border px-2 py-1 text-sm hover:bg-accent">{item.title}</Link>)}</div></section>}
      </section>

      {!isFocused && <aside data-testid="note-metadata-sidebar" className="space-y-6 xl:border-l xl:pl-6">
        <section data-testid="note-metadata-controls" className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select value={status} onValueChange={(value) => { if (!value) return; const next = value as typeof status; setStatus(next); void saveMeta(next, citationLocale); }}><SelectTrigger aria-label={t("allPageStatuses")} className="h-8 w-full"><SelectValue /></SelectTrigger><SelectContent>{["inbox","working","evergreen"].map((item) => <SelectItem key={item} value={item}>{t(`pageStatuses.${item}`)}</SelectItem>)}</SelectContent></Select>
            <Select value={citationLocale} onValueChange={(value) => { if (!value) return; setCitationLocale(value); void saveMeta(status, value); }}><SelectTrigger aria-label={t("citationLanguage")} className="h-8 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="de-DE">IEEE · DE</SelectItem><SelectItem value="en-US">IEEE · EN</SelectItem></SelectContent></Select>
          </div>
          <div className="flex items-center gap-1"><Input value={tags} onChange={(event) => setTags(event.target.value)} onBlur={() => void saveMeta()} placeholder={t("tagsHint")} className="h-8 min-w-0 text-xs" />{metaSaved && <Check className="size-4 shrink-0 text-emerald-600" />}</div>
        </section>
        <ContextPanel
          subjectType="wikiPage"
          subjectId={page.id}
          subjectLabel={page.title}
          subjectHref={`/wiki/pages/${page.slug}`}
          compact
          hideSources
        />
        <AttachmentPanel ref={attachmentRef} entityType="wikiPage" entityId={page.id} initial={attachments} />
        <EvidencePanel targetType="wikiPage" targetId={page.id} compact />
        <section ref={supportingSourceSectionRef}><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><BookMarked className="size-4 text-indigo-500" />{t("supportingSources")}</h3><div className="flex gap-1"><Select open={supportingSourceOpen} onOpenChange={setSupportingSourceOpen} value={sourceToLink} onValueChange={(value) => setSourceToLink(value ?? "")}><SelectTrigger aria-label={t("chooseSource")} data-testid="supporting-source-picker" ref={supportingSourceTriggerRef} className="min-w-0 flex-1"><SelectValue placeholder={t("chooseSource")} /></SelectTrigger><SelectContent>{sources.filter((source) => !research.supportingSources.some((linked) => linked.id === source.id)).map((source) => <SelectItem key={source.id} value={source.id}>{source.title}</SelectItem>)}</SelectContent></Select><Button aria-label={t("linkSupportingSource")} title={t("linkSupportingSource")} size="icon" variant="outline" disabled={!sourceToLink} onClick={async () => { await linkSupportingSource(page.id, sourceToLink); setSourceToLink(""); router.refresh(); }}><Plus className="size-4" /></Button></div><div className="mt-2 space-y-1">{research.supportingSources.map((source) => <div key={source.id} className="group flex items-center gap-1 rounded-md border p-2 text-xs"><Link href={`/wiki/sources/${source.id}`} className="min-w-0 flex-1 truncate font-medium">{source.title}</Link><button type="button" aria-label={`${t("editor.link.remove")}: ${source.title}`} title={t("editor.link.remove")} onClick={async () => { await unlinkSupportingSource(page.id, source.id); router.refresh(); }} className="rounded-sm p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"><X className="size-3" /></button></div>)}</div></section>
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="ghost" size="sm" onClick={async () => { const label = prompt(t("checkpointLabelPrompt")) ?? ""; await createPageCheckpoint(page.id, label); router.refresh(); }}><Plus className="size-4" />{t("checkpoint")}</Button><Button type="button" variant="outline" size="sm" onClick={() => setHistoryOpen(true)}><History className="size-4" />{t("history")}</Button></div>
      </aside>}
    </div>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-5xl">
        <DialogHeader><DialogTitle>{t("history")}</DialogTitle><DialogDescription>{t("historyComparisonDescription")}</DialogDescription></DialogHeader>
        {research.revisions.length ? <div className="grid min-h-0 gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav className="max-h-[65dvh] space-y-1 overflow-y-auto border-r pr-3" aria-label={t("history")}>
            {research.revisions.map((revision) => <button key={revision.id} type="button" onClick={() => setSelectedRevisionId(revision.id)} className={`w-full rounded-md px-2 py-2 text-left text-xs ${selectedRevision?.id === revision.id ? "bg-accent" : "hover:bg-accent/60"}`}><span className="font-medium">v{revision.contentVersion}</span> · {revision.label || t(`revisionKinds.${revision.kind}`)}<span className="mt-0.5 block text-muted-foreground">{revision.createdByName} · {format.dateTime(new Date(revision.createdAt), { dateStyle: "medium", timeStyle: "short" })}</span></button>)}
          </nav>
          <RevisionDiffView oldText={revisionText} currentText={currentText} oldTitle={t("selectedVersion", { version: selectedRevision?.version ?? 0 })} currentTitle={t("currentVersion")} />
        </div> : <p className="py-12 text-center text-sm text-muted-foreground">{t("noHistory")}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setHistoryOpen(false)}>{common("cancel")}</Button><Button type="button" disabled={!selectedRevision} onClick={async () => { if (!selectedRevision || !confirm(t("restoreRevisionConfirm"))) return; await restorePageRevision(selectedRevision.id); localStorage.removeItem(`wiki-draft:${page.id}`); location.reload(); }}>{t("restore")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
