"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ArrowLeft, BookMarked, Check, ChevronDown, Clock3, Download, Eye, FileText, History, Link2, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, Star, Trash2, X } from "lucide-react";
import { createPage, deletePage, renamePage } from "../actions";
import { createPageCheckpoint, linkSupportingSource, restorePageRevision, toggleFavorite, unlinkSupportingSource, updatePageResearchMeta, verifyPage } from "../research-actions";
import { CITATION_STYLES, isCitationStyle, type CitationSource, type CitationStyle } from "../lib/citations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WikiEditor } from "./wiki-editor";
import { AttachmentPanel, type AttachmentPanelHandle } from "./attachment-panel";
import { SvgGraphicsSection } from "./svg-graphics-section";
import type { WikiEditorHandle } from "./wiki-editor";
import { EvidencePanel } from "./evidence-panel";
import type { CommentThread } from "./comment-rail";
import { FocusModeToggle, useFocusMode } from "@/components/focus-mode";
import type { UserMarkColor } from "@/lib/user-mark-colors";
import type { StoredDocumentTemplate } from "../document-queries";
import type { WikiTypographySettingsV1, WikiTypographyTemplate } from "../lib/wiki-typography";
import { extractText, parseStoredDocument } from "../lib/tiptap";
import { RevisionDiffView } from "./revision-diff-view";
import { diffDocumentSettings } from "../lib/revision-diff";
import type { ContextDeadlineMarker, ContextTaskMarker } from "@/modules/tasks/types";
import type { ProposalWorkspaceData } from "../lib/proposal";
import { ContextPanel } from "@/modules/context/components/context-panel";

type PageRef = { id: string; title: string; slug: string };
type SourceRef = CitationSource;

function PageHeaderActions({ pageId, favorite, onNewSubpage, onToggleFavorite, onVerify, onDelete }: { pageId: string; favorite: boolean; onNewSubpage: () => void; onToggleFavorite: () => void; onVerify: () => void; onDelete: () => void }) {
  const t = useTranslations("wiki");
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title={t("editor.toolbar.more")} aria-label={t("editor.toolbar.more")} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuItem onClick={onNewSubpage}><Plus />{t("newSubpage")}</DropdownMenuItem>
      <DropdownMenuItem onClick={onToggleFavorite}><Star className={favorite ? "fill-indigo-400 text-indigo-500" : ""} />{t("favorite")}</DropdownMenuItem>
      <DropdownMenuItem onClick={onVerify}><Check />{t("markVerified")}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem render={<a href={"/api/wiki/pages/" + pageId + "/export?format=pdf&disposition=inline"} target="_blank" rel="noreferrer" />}><Eye />{t("document.previewPdf")}</DropdownMenuItem>
      <DropdownMenuItem render={<a href={"/api/wiki/pages/" + pageId + "/export?format=pdf"} />}><Download />{t("document.downloadPdf")}</DropdownMenuItem>
      <DropdownMenuItem render={<a href={"/api/wiki/pages/" + pageId + "/export?format=markdown"} />}><FileText />Markdown</DropdownMenuItem>
      <DropdownMenuItem render={<a href={"/api/wiki/pages/" + pageId + "/export?format=html"} />}><FileText />HTML</DropdownMenuItem>
      <DropdownMenuItem render={<a href={"/api/wiki/pages/" + pageId + "/export?format=docx"} />}><FileText />DOCX</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}><Trash2 />{t("deletePage")}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function WikiShell({ page, backlinks, unlinkedMentions = [], allPages, sources, research, comments, currentUserId, users, attachments, documentTemplates, typography, editableTypography, typographyTemplates, tasks, deadlines, focusTaskId, focusDeadlineId, insertEvidenceId, proposalData, allTags, meta }: {
  page: { id: string; title: string; slug: string; contentJson: string; status: "inbox" | "working" | "evergreen"; citationLocale: string; citationStyle: CitationStyle; verifiedUntil: string | null; proofingLanguage: "de-DE" | "en-US"; version: number; contentVersion: number; documentMode: boolean; documentSettingsJson: string; createdBy: string };
  backlinks: PageRef[]; unlinkedMentions?: PageRef[]; allPages: PageRef[]; sources: SourceRef[];
  research: { tags: Array<{ id: string; name: string; color: string }>; supportingSources: Array<{ id: string; title: string; issuedDate: string; relation: string }>; favorite: boolean; revisions: Array<{ id: string; version: number; contentVersion: number; contentHash: string; label: string | null; kind: string; createdAt: Date; createdByName: string; contentJson: string; documentSettingsJson: string }> };
  comments: CommentThread[]; currentUserId: string; users: Array<{ id: string; name: string; markColor: UserMarkColor }>;
  attachments: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number }>;
  documentTemplates: StoredDocumentTemplate[];
  typography: WikiTypographySettingsV1;
  editableTypography: WikiTypographySettingsV1;
  typographyTemplates: WikiTypographyTemplate[];
  tasks: ContextTaskMarker[];
  deadlines: ContextDeadlineMarker[];
  focusTaskId?: string;
  insertEvidenceId?: string;
  focusDeadlineId?: string;
  proposalData: ProposalWorkspaceData;
  allTags: Array<{ id: string; name: string }>;
  meta: { updatedAt: number; updatedByName: string } | null;
}) {
  const t = useTranslations("wiki"); const common = useTranslations("common"); const format = useFormatter(); const locale = useLocale(); const router = useRouter();
  const { isFocused } = useFocusMode();
  const [status, setStatus] = useState(page.status); const [citationLocale, setCitationLocale] = useState(page.citationLocale);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>(page.citationStyle);
  const [verifiedUntil, setVerifiedUntil] = useState(page.verifiedUntil);
  // Captured once per mount: reading the clock during render is impure.
  const [renderedAt] = useState(() => Date.now());
  const verificationOverdue = Boolean(verifiedUntil && new Date(verifiedUntil).getTime() < renderedAt);
  async function runVerify(months: number) {
    const result = await verifyPage({ pageId: page.id, months });
    setVerifiedUntil(result.verifiedUntil);
  }
  const [tags, setTags] = useState(research.tags.map((tag) => tag.name).join(", "));
  const tagNames = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  // ponytail: clicking existing tags is what stops typo duplicates; the field stays free text for new ones.
  function toggleTag(name: string) {
    const next = tagNames.includes(name) ? tagNames.filter((tag) => tag !== name) : [...tagNames, name];
    setTags(next.join(", "));
    void saveMeta(status, citationLocale, next.join(", "));
  } const [metaSaved, setMetaSaved] = useState(false);
  const [sourceToLink, setSourceToLink] = useState("");
  const [supportingSourceOpen, setSupportingSourceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedRevisionsOnly, setSavedRevisionsOnly] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [supportingSourcesCollapsed, setSupportingSourcesCollapsed] = useState(true);
  const [selectedRevisionId, setSelectedRevisionId] = useState(research.revisions[0]?.id ?? "");
  const editorActions = useRef<WikiEditorHandle | null>(null);
  const attachmentRef = useRef<AttachmentPanelHandle>(null); const supportingSourceSectionRef = useRef<HTMLElement>(null); const supportingSourceTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedRevision = research.revisions.find((revision) => revision.id === selectedRevisionId) ?? research.revisions[0];
  const visibleRevisions = savedRevisionsOnly ? research.revisions.filter((revision) => revision.kind !== "autosave") : research.revisions;
  // "current" is a sentinel for the live page, so any two revisions can be compared and
  // not only a revision against current.
  const [compareToId, setCompareToId] = useState("current");
  const compareRevision = research.revisions.find((revision) => revision.id === compareToId);
  const currentText = extractText(parseStoredDocument(compareRevision?.contentJson ?? page.contentJson));
  const revisionText = selectedRevision ? extractText(parseStoredDocument(selectedRevision.contentJson)) : "";
  const settingsChanges = selectedRevision
    ? diffDocumentSettings(
        selectedRevision.documentSettingsJson ?? "",
        compareRevision?.documentSettingsJson ?? page.documentSettingsJson,
      )
    : [];

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDetailsOpen(localStorage.getItem("wiki:document-details-open") === "true"));
    return () => cancelAnimationFrame(frame);
  }, []);

  function changeDetailsOpen(open: boolean) {
    setDetailsOpen(open);
    localStorage.setItem("wiki:document-details-open", String(open));
  }

  function openAttachmentPicker() {
    changeDetailsOpen(true);
    setTimeout(() => attachmentRef.current?.openFilePicker(), 0);
  }

  function openSupportingSourcePicker() {
    changeDetailsOpen(true);
    setTimeout(() => {
      supportingSourceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setSupportingSourceOpen(true);
      supportingSourceTriggerRef.current?.focus();
    }, 0);
  }

  async function saveMeta(nextStatus = status, nextLocale = citationLocale, nextTags = tags, nextStyle = citationStyle) {
    await updatePageResearchMeta({ pageId: page.id, status: nextStatus, citationLocale: nextLocale as "de-DE" | "en-US", citationStyle: nextStyle, tagNames: nextTags.split(",").map((tag) => tag.trim()).filter(Boolean) });
    setMetaSaved(true); setTimeout(() => setMetaSaved(false), 1600); router.refresh();
  }

  async function rename() { const title = prompt(t("pageTitle"), page.title); if (!title?.trim()) return; const renamed = await renamePage(page.id, title.trim()); if (renamed.slug !== page.slug) router.replace(`/wiki/pages/${encodeURIComponent(renamed.slug)}`); router.refresh(); }
  async function remove() { if (!confirm(common("confirmDeleteTitle"))) return; await deletePage(page.id); router.push("/wiki/inbox"); router.refresh(); }

  return <div className={isFocused ? "w-full max-w-none p-4 md:p-7" : "mx-auto max-w-[112rem] p-4 md:p-7"}>
    <header className="mb-5 border-b pb-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-2"><Link href="/wiki" aria-label={t("backToWikiStart")} title={t("backToWikiStart")} className="mt-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowLeft className="size-4" /></Link><div className="min-w-0"><button type="button" aria-label={`${t("rename")}: ${page.title}`} onClick={rename} className={isFocused ? "max-w-4xl text-left text-2xl font-semibold tracking-tight hover:text-indigo-700 dark:hover:text-indigo-300" : "max-w-4xl text-left text-3xl font-semibold tracking-tight hover:text-indigo-700 dark:hover:text-indigo-300"}>{page.title}</button>{!isFocused && meta && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{t("lastEdited", { name: meta.updatedByName })} · {format.dateTime(new Date(meta.updatedAt), { dateStyle: "medium", timeStyle: "short" })}</p>}</div></div>
        <div className="flex items-center gap-1">{!isFocused && <><Button variant={detailsOpen ? "secondary" : "ghost"} size="sm" className="gap-1.5" title={detailsOpen ? t("hideDocumentDetails") : t("showDocumentDetails")} aria-label={detailsOpen ? t("hideDocumentDetails") : t("showDocumentDetails")} aria-pressed={detailsOpen} onClick={() => changeDetailsOpen(!detailsOpen)}>{detailsOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}<span className="hidden text-xs sm:inline">{t("documentDetails")}</span></Button><PageHeaderActions pageId={page.id} favorite={research.favorite} onNewSubpage={async () => { const title = prompt(t("pageTitle")); if (!title?.trim()) return; const child = await createPage({ title: title.trim(), parentId: page.id, proofingLanguage: locale === "en" ? "en-US" : "de-DE" }); router.push("/wiki/pages/" + child.slug); router.refresh(); }} onToggleFavorite={async () => { await toggleFavorite("page", page.id); router.refresh(); }} onVerify={() => void runVerify(6)} onDelete={remove} /></>}<FocusModeToggle compact={isFocused} /></div></div>
    </header>

    <div className={isFocused || !detailsOpen ? "w-full" : "grid gap-7 xl:grid-cols-[minmax(0,1fr)_17rem]"}>
      <section className="min-w-0">
        {!isFocused && (verifiedUntil || verificationOverdue) && (
          <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${verificationOverdue ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/5"}`}>
            <Check className={`size-4 ${verificationOverdue ? "text-amber-600" : "text-emerald-600"}`} />
            <span>{verificationOverdue
              ? t("verificationOverdue", { date: format.dateTime(new Date(verifiedUntil!), { dateStyle: "medium" }) })
              : t("verifiedUntilLabel", { date: format.dateTime(new Date(verifiedUntil!), { dateStyle: "medium" }) })}</span>
            <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={() => void runVerify(6)}>{t("verifyAgain")}</Button>
          </div>
        )}
        <WikiEditor key={page.id} actionsRef={editorActions} focused={isFocused} pageId={page.id} pageTitle={page.title} pageSlug={page.slug} pageVersion={page.version} pageContentVersion={page.contentVersion} initialContent={page.contentJson} initialProofingLanguage={page.proofingLanguage} initialDocumentMode={page.documentMode} initialDocumentSettings={page.documentSettingsJson} initialTypography={typography} editableTypography={editableTypography} typographyTemplates={typographyTemplates} isPrimaryAuthor={page.createdBy === currentUserId} documentTemplates={documentTemplates} allPages={allPages} sources={sources} users={users} citationLocale={citationLocale} citationStyle={citationStyle} insertEvidenceId={insertEvidenceId} comments={comments} contextTasks={tasks} contextDeadlines={deadlines} focusTaskId={focusTaskId} focusDeadlineId={focusDeadlineId} proposalData={proposalData} currentUserId={currentUserId} pageActions={{ addAttachment: openAttachmentPicker, linkSupportingSource: openSupportingSourcePicker }} />
        {!isFocused && backlinks.length > 0 && <section className="mt-8 border-t pt-5"><h2 className="mb-3 flex items-center gap-2 text-sm font-medium"><Link2 className="size-4 text-indigo-500" />{t("backlinks")}</h2><div className="flex flex-wrap gap-2">{backlinks.map((item) => <Link key={item.id} href={`/wiki/pages/${item.slug}`} className="rounded-md border px-2 py-1 text-sm hover:bg-accent">{item.title}</Link>)}</div></section>}
        {!isFocused && unlinkedMentions.length > 0 && <section className="mt-6"><h2 className="mb-1 flex items-center gap-2 text-sm font-medium"><Link2 className="size-4 text-muted-foreground" />{t("unlinkedMentions")}</h2><p className="mb-3 text-xs text-muted-foreground">{t("unlinkedMentionsHint")}</p><div className="flex flex-wrap gap-2">{unlinkedMentions.map((item) => <Link key={item.id} href={`/wiki/pages/${item.slug}`} className="rounded-md border border-dashed px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">{item.title}</Link>)}</div></section>}
      </section>

      {!isFocused && detailsOpen && <aside data-testid="note-metadata-sidebar" className="mt-6 space-y-6 border-t pt-5 xl:sticky xl:top-4 xl:mt-0 xl:self-start xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
        <section data-testid="note-metadata-controls" className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select value={status} onValueChange={(value) => { if (!value) return; const next = value as typeof status; setStatus(next); void saveMeta(next, citationLocale); }}><SelectTrigger aria-label={t("allPageStatuses")} className="h-8 w-full"><SelectValue /></SelectTrigger><SelectContent>{["inbox","working","evergreen"].map((item) => <SelectItem key={item} value={item}>{t(`pageStatuses.${item}`)}</SelectItem>)}</SelectContent></Select>
            <Select value={citationLocale} onValueChange={(value) => { if (!value) return; setCitationLocale(value); void saveMeta(status, value); }}><SelectTrigger aria-label={t("citationLanguage")} className="h-8 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="de-DE">DE</SelectItem><SelectItem value="en-US">EN</SelectItem></SelectContent></Select>
            <Select value={citationStyle} onValueChange={(value) => { if (!value || !isCitationStyle(value)) return; setCitationStyle(value); void saveMeta(status, citationLocale, tags, value); }}><SelectTrigger aria-label={t("citationStyle")} className="h-8 w-full"><SelectValue /></SelectTrigger><SelectContent>{CITATION_STYLES.map((item) => <SelectItem key={item} value={item}>{t(`citationStyles.${item}`)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="flex items-center gap-1"><Input value={tags} onChange={(event) => setTags(event.target.value)} onBlur={() => void saveMeta()} placeholder={t("tagsHint")} className="h-8 min-w-0 text-xs" />{metaSaved && <Check className="size-4 shrink-0 text-emerald-600" />}</div>
          {allTags.length > 0 && <div className="flex flex-wrap gap-1" aria-label={t("existingTags")}>{allTags.map((tag) => { const active = tagNames.includes(tag.name); return <button key={tag.id} type="button" aria-pressed={active} onClick={() => toggleTag(tag.name)} className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${active ? "bg-indigo-500 text-white" : "bg-muted text-muted-foreground hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950 dark:hover:text-indigo-200"}`}>{tag.name}</button>; })}</div>}
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
        <SvgGraphicsSection pageId={page.id} onInsert={(asset) => editorActions.current?.insertGraphic(asset)} />
        <EvidencePanel targetType="wikiPage" targetId={page.id} compact />
        <section ref={supportingSourceSectionRef}><button type="button" aria-expanded={!supportingSourcesCollapsed} onClick={() => setSupportingSourcesCollapsed((collapsed) => !collapsed)} className="flex w-full items-center gap-2 text-left text-sm font-medium"><ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${supportingSourcesCollapsed ? "-rotate-90" : ""}`} /><BookMarked className="size-4 text-indigo-500" />{t("supportingSources")}</button>{!supportingSourcesCollapsed && <><div className="mt-2 flex gap-1"><Select open={supportingSourceOpen} onOpenChange={setSupportingSourceOpen} value={sourceToLink} onValueChange={(value) => setSourceToLink(value ?? "")}><SelectTrigger aria-label={t("chooseSource")} data-testid="supporting-source-picker" ref={supportingSourceTriggerRef} className="min-w-0 flex-1"><SelectValue placeholder={t("chooseSource")} /></SelectTrigger><SelectContent>{sources.filter((source) => !research.supportingSources.some((linked) => linked.id === source.id)).map((source) => <SelectItem key={source.id} value={source.id}>{source.title}</SelectItem>)}</SelectContent></Select><Button aria-label={t("linkSupportingSource")} title={t("linkSupportingSource")} size="icon" variant="outline" disabled={!sourceToLink} onClick={async () => { await linkSupportingSource(page.id, sourceToLink); setSourceToLink(""); router.refresh(); }}><Plus className="size-4" /></Button></div><div className="mt-2 space-y-1">{research.supportingSources.map((source) => <div key={source.id} className="group flex items-center gap-1 rounded-md border p-2 text-xs"><Link href={`/wiki/sources/${source.id}`} className="min-w-0 flex-1 truncate font-medium">{source.title}</Link><button type="button" aria-label={`${t("editor.link.remove")}: ${source.title}`} title={t("editor.link.remove")} onClick={async () => { await unlinkSupportingSource(page.id, source.id); router.refresh(); }} className="rounded-sm p-1 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"><X className="size-3" /></button></div>)}</div></>}</section>
        <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="ghost" size="sm" onClick={async () => { const label = prompt(t("checkpointLabelPrompt")) ?? ""; await createPageCheckpoint(page.id, label); router.refresh(); }}><Plus className="size-4" />{t("checkpoint")}</Button><Button type="button" variant="outline" size="sm" onClick={() => setHistoryOpen(true)}><History className="size-4" />{t("history")}</Button></div>
      </aside>}
    </div>
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
      <DialogContent className="max-h-[90dvh] overflow-hidden sm:max-w-5xl">
        <DialogHeader><DialogTitle>{t("history")}</DialogTitle><DialogDescription>{t("historyComparisonDescription")}</DialogDescription></DialogHeader>
        {research.revisions.length ? <div className="grid min-h-0 gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
          <nav className="max-h-[65dvh] space-y-1 overflow-y-auto border-r pr-3" aria-label={t("history")}>
            <Button type="button" variant={savedRevisionsOnly ? "secondary" : "outline"} size="xs" aria-pressed={savedRevisionsOnly} className="mb-2 w-full" onClick={() => setSavedRevisionsOnly((value) => !value)}><BookMarked className="size-3" />{t("savedVersionsOnly")}</Button>
            {visibleRevisions.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{t("noSavedVersions")}</p>}
            {visibleRevisions.map((revision) => <button key={revision.id} type="button" onClick={() => setSelectedRevisionId(revision.id)} className={`w-full rounded-md px-2 py-2 text-left text-xs ${selectedRevision?.id === revision.id ? "bg-accent" : "hover:bg-accent/60"}`}><span className="font-medium">v{revision.contentVersion}</span> · {revision.label || t(`revisionKinds.${revision.kind}`)}<span className="mt-0.5 block text-muted-foreground">{revision.createdByName} · {format.dateTime(new Date(revision.createdAt), { dateStyle: "medium", timeStyle: "short" })}</span></button>)}
          </nav>
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("compareWith")}</span>
              <Select value={compareToId} onValueChange={(value) => { if (value) setCompareToId(value); }}>
                <SelectTrigger aria-label={t("compareWith")} className="h-8 w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">{t("currentVersion")}</SelectItem>
                  {visibleRevisions.filter((revision) => revision.id !== selectedRevision?.id).map((revision) => (
                    <SelectItem key={revision.id} value={revision.id}>v{revision.contentVersion} · {revision.label || t(`revisionKinds.${revision.kind}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {settingsChanges.length > 0 && <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">{t("layoutChanges", { count: settingsChanges.length })}</summary>
              <ul className="mt-2 space-y-0.5 font-mono">
                {settingsChanges.map((change) => <li key={change.path}>
                  <span className="text-muted-foreground">{change.path}</span>{": "}
                  <span className="text-red-700 dark:text-red-300">{change.from || "—"}</span>{" → "}
                  <span className="text-green-700 dark:text-green-300">{change.to || "—"}</span>
                </li>)}
              </ul>
            </details>}
            <RevisionDiffView oldText={revisionText} currentText={currentText} oldTitle={t("selectedVersion", { version: selectedRevision?.version ?? 0 })} currentTitle={compareRevision ? t("selectedVersion", { version: compareRevision.version }) : t("currentVersion")} />
          </div>
        </div> : <p className="py-12 text-center text-sm text-muted-foreground">{t("noHistory")}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setHistoryOpen(false)}>{common("cancel")}</Button><Button type="button" disabled={!selectedRevision} onClick={async () => { if (!selectedRevision || !confirm(t("restoreRevisionConfirm"))) return; await restorePageRevision(selectedRevision.id); localStorage.removeItem(`wiki-draft:${page.id}`); location.reload(); }}>{t("restore")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
