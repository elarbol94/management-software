"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Mark, Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Underline from "@tiptap/extension-underline";
import { Bold, BookMarked, Code, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, List, ListOrdered, ListTodo, MessageSquareText, Quote, RotateCcw, Strikethrough, Underline as UnderlineIcon } from "lucide-react";
import { savePageContent } from "../actions";
import { addComment, restorePageRevision } from "../research-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PageRef = { id: string; title: string; slug: string };
type SourceRef = { id: string; title: string; issuedDate: string; contributors: string };

const Citation = Node.create({
  name: "citation", group: "inline", inline: true, atom: true,
  addAttributes() { return { items: { default: [] }, label: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-citation]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-citation": "", class: "wiki-citation" }), HTMLAttributes.label || "(citation)"]; },
});

const CommentMark = Mark.create({
  name: "comment", inclusive: false,
  addAttributes() { return { threadId: { default: null, parseHTML: (element) => element.getAttribute("data-comment-thread") } }; },
  parseHTML() { return [{ tag: "mark[data-comment-thread]" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", mergeAttributes(HTMLAttributes, { "data-comment-thread": HTMLAttributes.threadId, class: "wiki-comment-anchor" }), 0]; },
});

const Highlight = Mark.create({
  name: "highlight",
  parseHTML() { return [{ tag: "mark:not([data-comment-thread])" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", mergeAttributes(HTMLAttributes, { class: "wiki-highlight" }), 0]; },
});

function ToolbarButton({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return <Button type="button" variant={active ? "secondary" : "ghost"} size="icon-sm" title={title} onMouseDown={(event) => { event.preventDefault(); onClick(); }}>{children}</Button>;
}

function PageLinkPicker({ editor, pages }: { editor: Editor; pages: PageRef[] }) {
  const t = useTranslations("wiki"); const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("linkPage")} />}><Link2 className="size-4" /></PopoverTrigger><PopoverContent className="w-72 p-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filterPages")} className="mb-2 h-8" /><div className="max-h-60 overflow-y-auto">{pages.filter((page) => page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((page) => <button key={page.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { const { empty } = editor.state.selection; const href = `/wiki/pages/${page.slug}`; if (empty) editor.chain().focus().insertContent({ type: "text", text: page.title, marks: [{ type: "link", attrs: { href } }] }).run(); else editor.chain().focus().setLink({ href }).run(); setOpen(false); }}>{page.title}</button>)}</div></PopoverContent></Popover>;
}

function CitationPicker({ editor, sources, locale }: { editor: Editor; sources: SourceRef[]; locale: string }) {
  const t = useTranslations("wiki"); const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [locator, setLocator] = useState("");
  function insert(source: SourceRef) { const author = source.contributors.split(",")[0]?.trim() || source.title; const year = source.issuedDate.slice(0, 4) || (locale.startsWith("de") ? "o. J." : "n.d."); const label = `(${author}, ${year}${locator ? `, ${locale.startsWith("de") ? "S." : "p."} ${locator}` : ""})`; editor.chain().focus().insertContent({ type: "citation", attrs: { items: [{ sourceId: source.id, locator: locator || undefined, locatorType: "page" }], label } }).run(); setOpen(false); setLocator(""); setQuery(""); }
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("insertCitation")} />}><BookMarked className="size-4" /></PopoverTrigger><PopoverContent className="w-80 p-2"><div className="grid grid-cols-[1fr_5rem] gap-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("findSource")} className="h-8" /><Input value={locator} onChange={(event) => setLocator(event.target.value)} placeholder={t("pageShort")} className="h-8" /></div><div className="mt-2 max-h-64 overflow-y-auto">{sources.filter((source) => `${source.title} ${source.contributors}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((source) => <button key={source.id} type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => insert(source)}><span className="block text-sm font-medium">{source.title}</span><span className="text-xs text-muted-foreground">{source.contributors || "—"} · {source.issuedDate.slice(0,4) || "—"}</span></button>)}</div></PopoverContent></Popover>;
}

export function WikiEditor({ pageId, pageVersion, initialContent, allPages, sources, users, citationLocale }: { pageId: string; pageVersion: number; initialContent: string; allPages: PageRef[]; sources: SourceRef[]; users: Array<{ id: string; name: string }>; citationLocale: string }) {
  const t = useTranslations("wiki"); const router = useRouter(); const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "conflict">("idle");
  const [conflictRevision, setConflictRevision] = useState<string | null>(null); const [commentOpen, setCommentOpen] = useState(false); const [commentBody, setCommentBody] = useState(""); const [commentQuote, setCommentQuote] = useState(""); const [assigneeId, setAssigneeId] = useState("none");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const version = useRef(pageVersion); const selection = useRef<{ from: number; to: number } | null>(null); const storageKey = `wiki-draft:${pageId}`;
  let content: object | undefined; try { content = initialContent ? JSON.parse(initialContent) : undefined; } catch { content = undefined; }
  if (typeof window !== "undefined") { const draft = window.localStorage.getItem(storageKey); if (draft && draft !== initialContent) { try { content = JSON.parse(draft); } catch { /* ignore damaged recovery */ } } }

  const editor = useEditor({ immediatelyRender: false, extensions: [StarterKit.configure({ link: { openOnClick: false } }), TaskList, TaskItem.configure({ nested: true }), Underline, Citation, CommentMark, Highlight], content,
    editorProps: { attributes: { class: "prose prose-neutral dark:prose-invert max-w-none min-h-[28rem] focus:outline-none text-[15px] leading-7" } },
    onUpdate({ editor }) { const json = JSON.stringify(editor.getJSON()); localStorage.setItem(storageKey, json); setSaveState("saving"); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(async () => { try { const result = await savePageContent({ id: pageId, contentJson: json, expectedVersion: version.current }); if (result.saved) { version.current = result.version; localStorage.removeItem(storageKey); setSaveState("saved"); } else if (result.conflict) { setConflictRevision(result.revisionId); setSaveState("conflict"); } } catch { setSaveState("idle"); } }, 800); },
  });

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  if (!editor) return <div className="min-h-[28rem]" />;
  function externalLink() { const previous = editor.getAttributes("link").href as string | undefined; const url = prompt("URL", previous ?? "https://"); if (url === null) return; if (!url) editor.chain().focus().unsetLink().run(); else editor.chain().focus().setLink({ href: url }).run(); }
  function prepareComment() { const { from, to, empty } = editor.state.selection; if (empty) return; selection.current = { from, to }; setCommentQuote(editor.state.doc.textBetween(from, to, " ")); setCommentOpen(true); }
  async function submitComment() { if (!selection.current || !commentBody.trim()) return; const result = await addComment({ pageId, body: commentBody, anchorQuote: commentQuote, assigneeId: assigneeId === "none" ? null : assigneeId }); editor.chain().focus().setTextSelection(selection.current).setMark("comment", { threadId: result.threadId }).run(); setCommentOpen(false); setCommentBody(""); setAssigneeId("none"); selection.current = null; router.refresh(); }

  return <div className="relative flex flex-col gap-3"><div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur">
    <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="size-4" /></ToolbarButton><ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></ToolbarButton><ToolbarButton title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="size-4" /></ToolbarButton><ToolbarButton title="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleMark("highlight").run()}><Highlighter className="size-4" /></ToolbarButton><ToolbarButton title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="size-4" /></ToolbarButton><span className="mx-1 h-5 w-px bg-border" />
    {[1,2,3].map((level) => { const Icon = level === 1 ? Heading1 : level === 2 ? Heading2 : Heading3; return <ToolbarButton key={level} title={`H${level}`} active={editor.isActive("heading", { level })} onClick={() => editor.chain().focus().toggleHeading({ level: level as 1|2|3 }).run()}><Icon className="size-4" /></ToolbarButton>; })}<span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="size-4" /></ToolbarButton><ToolbarButton title="Ordered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></ToolbarButton><ToolbarButton title="Task list" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListTodo className="size-4" /></ToolbarButton><ToolbarButton title="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="size-4" /></ToolbarButton><ToolbarButton title="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code className="size-4" /></ToolbarButton><span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton title={t("insertLink")} active={editor.isActive("link")} onClick={externalLink}><Link2 className="size-4 rotate-45" /></ToolbarButton><PageLinkPicker editor={editor} pages={allPages} /><CitationPicker editor={editor} sources={sources} locale={citationLocale} /><ToolbarButton title={t("inlineComment")} onClick={prepareComment}><MessageSquareText className="size-4" /></ToolbarButton>
    <span className="ml-auto px-2 text-xs text-muted-foreground">{saveState === "saving" && t("saving")}{saveState === "saved" && t("saved")}{saveState === "conflict" && <span className="text-amber-700">{t("editConflict")}</span>}</span>
  </div>
  {saveState === "conflict" && conflictRevision && <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><RotateCcw className="size-4" /><span className="flex-1">{t("editConflictDescription")}</span><Button size="sm" variant="outline" onClick={() => location.reload()}>{t("loadCurrent")}</Button><Button size="sm" onClick={async () => { await restorePageRevision(conflictRevision); location.reload(); }}>{t("restoreMine")}</Button></div>}
  <EditorContent editor={editor} data-testid="wiki-editor" />
  <Dialog open={commentOpen} onOpenChange={setCommentOpen}><DialogContent><DialogHeader><DialogTitle>{t("inlineComment")}</DialogTitle></DialogHeader><blockquote className="border-l-2 border-indigo-400 pl-3 text-sm italic text-muted-foreground">{commentQuote}</blockquote><Textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder={t("commentPlaceholder")} /><Select value={assigneeId} onValueChange={setAssigneeId}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("unassigned")}</SelectItem>{users.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select><Button onClick={submitComment} disabled={!commentBody.trim()}>{t("addComment")}</Button></DialogContent></Dialog>
  </div>;
}
