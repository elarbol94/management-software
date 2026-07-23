"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { AlignLeft, Bold, BookMarked, Code, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, ListTodo, MessageSquareText, Minus, Paperclip, Quote, RotateCcw, Eye, EyeOff, Scan, Strikethrough, Underline as UnderlineIcon } from "lucide-react";
import { savePageContent } from "../actions";
import { addComment, restorePageRevision } from "../research-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createSlashCommandExtension, type SlashCommandDefinition } from "./slash-command-menu";
import { CommentRail, type CommentRailHandle, type CommentThread } from "./comment-rail";
import { CommentAnchorOverlay } from "./comment-anchor-overlay";
import { mergeCommentThreadIds, normalizeImageRect, type CommentAnchor } from "../lib/comment-anchors";

type PageRef = { id: string; title: string; slug: string };
type SourceRef = { id: string; title: string; issuedDate: string; contributors: string };
type WikiEditorPageActions = { addAttachment: () => void; linkSupportingSource: () => void };

const Citation = Node.create({
  name: "citation", group: "inline", inline: true, atom: true,
  addAttributes() { return { items: { default: [] }, label: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-citation]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-citation": "", class: "wiki-citation" }), HTMLAttributes.label || "(citation)"]; },
});

const PdfEvidence = Node.create({
  name: "pdfEvidence", group: "block", atom: true, selectable: true,
  addAttributes() { return { nodeId: { default: "" }, annotationId: { default: "" }, sourceId: { default: "" }, documentId: { default: "" }, pageNumber: { default: 1 }, kind: { default: "text" }, quote: { default: "" }, label: { default: "" }, sourceTitle: { default: "" }, previewUrl: { default: "" } }; },
  parseHTML() { return [{ tag: "aside[data-pdf-evidence]" }, { tag: "figure[data-pdf-evidence]" }]; },
  renderHTML({ HTMLAttributes }) {
    const text = HTMLAttributes.quote || HTMLAttributes.label || HTMLAttributes.sourceTitle || "PDF evidence";
    const attributes = mergeAttributes(HTMLAttributes, { "data-pdf-evidence": HTMLAttributes.annotationId, "data-comment-node-id": HTMLAttributes.nodeId, class: "wiki-commentable-media my-4 rounded-lg border-l-4 border-indigo-400 bg-indigo-50/60 p-4 text-sm dark:bg-indigo-950/20" });
    if (HTMLAttributes.kind === "region" && HTMLAttributes.previewUrl) return ["figure", attributes, ["img", { src: HTMLAttributes.previewUrl, alt: text, class: "max-h-96 rounded object-contain" }], ["figcaption", { class: "mt-2 text-xs text-muted-foreground" }, text]];
    return ["aside", attributes, text];
  },
});

const CommentableImage = Node.create({
  name: "commentableImage", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() {
    return {
      nodeId: { default: "" },
      attachmentId: { default: "" },
      src: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
    };
  },
  parseHTML() { return [{ tag: "figure[data-commentable-image]" }]; },
  renderHTML({ HTMLAttributes }) {
    const label = HTMLAttributes.caption || HTMLAttributes.alt || "Image";
    return ["figure", {
      "data-commentable-image": "",
      "data-comment-node-id": HTMLAttributes.nodeId,
      "data-attachment-id": HTMLAttributes.attachmentId,
      class: "wiki-commentable-media my-5",
    }, ["img", { src: HTMLAttributes.src, alt: HTMLAttributes.alt || label, class: "max-h-[36rem] w-auto max-w-full rounded-lg object-contain" }],
    ...(label ? [["figcaption", { class: "mt-2 text-center text-xs text-muted-foreground" }, label]] : [])];
  },
});

const CommentMark = Mark.create({
  name: "comment", inclusive: false,
  addAttributes() {
    return {
      threadId: { default: null, parseHTML: (element) => element.getAttribute("data-comment-thread") },
      threadIds: {
        default: [],
        parseHTML: (element) => {
          const ids = (element.getAttribute("data-comment-threads") ?? "").split(/\s+/).filter(Boolean);
          const legacy = element.getAttribute("data-comment-thread");
          if (legacy && !ids.includes(legacy)) ids.unshift(legacy);
          return ids;
        },
      },
    };
  },
  parseHTML() { return [{ tag: "mark[data-comment-thread]" }, { tag: "mark[data-comment-threads]" }]; },
  renderHTML({ HTMLAttributes }) {
    const ids = mergeCommentThreadIds(HTMLAttributes, "");
    const normalized = ids.filter(Boolean);
    return ["mark", { "data-comment-thread": normalized[0], "data-comment-threads": normalized.join(" "), class: "wiki-comment-anchor" }, 0];
  },
});

const Highlight = Mark.create({
  name: "highlight",
  parseHTML() { return [{ tag: "mark:not([data-comment-thread])" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", mergeAttributes(HTMLAttributes, { class: "wiki-highlight" }), 0]; },
});

function ToolbarButton({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return <Button type="button" variant={active ? "secondary" : "ghost"} size="icon-sm" title={title} onMouseDown={(event) => { event.preventDefault(); onClick(); }}>{children}</Button>;
}

function addThreadMark(editor: Editor, range: { from: number; to: number }, threadId: string) {
  const markType = editor.state.schema.marks.comment;
  if (!markType) return;
  const transaction = editor.state.tr;
  editor.state.doc.nodesBetween(range.from, range.to, (node, position) => {
    if (!node.isText) return;
    const from = Math.max(range.from, position);
    const to = Math.min(range.to, position + node.nodeSize);
    if (from >= to) return;
    const existing = node.marks.find((mark) => mark.type === markType);
    const threadIds = mergeCommentThreadIds(existing?.attrs ?? {}, threadId);
    transaction.removeMark(from, to, markType);
    transaction.addMark(from, to, markType.create({ threadId: null, threadIds }));
  });
  editor.view.dispatch(transaction);
}

function backfillCommentNodeIds(editor: Editor) {
  let transaction = editor.state.tr;
  editor.state.doc.descendants((node, position) => {
    if ((node.type.name === "pdfEvidence" || node.type.name === "commentableImage") && !node.attrs.nodeId) {
      transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, nodeId: crypto.randomUUID() });
    }
  });
  if (transaction.docChanged) editor.view.dispatch(transaction);
}

type UploadedAttachment = { id: string; fileName: string; mimeType: string };
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

async function uploadInlineAttachment(pageId: string, file: File): Promise<UploadedAttachment> {
  const data = new FormData();
  data.set("file", file);
  data.set("entityType", "wikiPage");
  data.set("entityId", pageId);
  const response = await fetch("/api/files", { method: "POST", body: data });
  const result = await response.json() as UploadedAttachment & { error?: string };
  if (!response.ok) throw new Error(result.error || "Upload failed");
  return result;
}

function imageNodeAttrs(attachment: UploadedAttachment) {
  return {
    nodeId: crypto.randomUUID(),
    attachmentId: attachment.id,
    src: `/api/files/${attachment.id}`,
    alt: attachment.fileName,
    caption: attachment.fileName,
  };
}

function ImageRegionSelector({ rootRef, nodeId, label, onSelect, onCancel }: {
  rootRef: React.RefObject<HTMLDivElement | null>;
  nodeId: string;
  label: string;
  onSelect: (anchor: CommentAnchor) => void;
  onCancel: () => void;
}) {
  const [bounds, setBounds] = useState<DOMRect | null>(null);
  const [drag, setDrag] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const container = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-comment-node-id]") ?? [])]
        .find((element) => element.dataset.commentNodeId === nodeId);
      setBounds((container?.querySelector("img") ?? container)?.getBoundingClientRect() ?? null);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [nodeId, rootRef]);

  if (!bounds) return null;
  const preview = drag ? normalizeImageRect(drag, bounds) : null;
  return <div
    data-testid="image-region-selector"
    className="fixed z-50 cursor-crosshair touch-none bg-amber-300/10 ring-2 ring-amber-500"
    style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
    onPointerDown={(event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ startX: event.clientX - bounds.left, startY: event.clientY - bounds.top, endX: event.clientX - bounds.left, endY: event.clientY - bounds.top });
    }}
    onPointerMove={(event) => setDrag((value) => value ? { ...value, endX: event.clientX - bounds.left, endY: event.clientY - bounds.top } : null)}
    onPointerUp={(event) => {
      if (!drag) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const rect = normalizeImageRect({ ...drag, endX: event.clientX - bounds.left, endY: event.clientY - bounds.top }, bounds);
      if (rect.width * bounds.width >= 12 && rect.height * bounds.height >= 12) onSelect({ type: "image", nodeId, mode: "region", rect, label });
      else setDrag(null);
    }}
    onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}
    role="application"
    tabIndex={0}
    aria-label="Select image region"
  >
    <button type="button" className="absolute top-2 right-2 rounded bg-background/95 px-2 py-1 text-xs shadow" onPointerDown={(event) => event.stopPropagation()} onClick={onCancel}>×</button>
    {preview && <div className="absolute border-2 border-amber-600 bg-amber-300/30" style={{ left: `${preview.x * 100}%`, top: `${preview.y * 100}%`, width: `${preview.width * 100}%`, height: `${preview.height * 100}%` }} />}
  </div>;
}

function PageLinkPicker({ editor, pages, open, onOpenChange }: { editor: Editor; pages: PageRef[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("wiki"); const [query, setQuery] = useState("");
  return <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("linkPage")} />}><Link2 className="size-4" /></PopoverTrigger><PopoverContent className="w-72 p-2"><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filterPages")} className="mb-2 h-8" /><div className="max-h-60 overflow-y-auto">{pages.filter((page) => page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((page) => <button key={page.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { const { empty } = editor.state.selection; const href = `/wiki/pages/${page.slug}`; if (empty) editor.chain().focus().insertContent({ type: "text", text: page.title, marks: [{ type: "link", attrs: { href } }] }).run(); else editor.chain().focus().setLink({ href }).run(); onOpenChange(false); }}>{page.title}</button>)}</div></PopoverContent></Popover>;
}

function CitationPicker({ editor, sources, locale, open, onOpenChange }: { editor: Editor; sources: SourceRef[]; locale: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("wiki"); const [query, setQuery] = useState(""); const [locator, setLocator] = useState("");
  function insert(source: SourceRef) { const author = source.contributors.split(",")[0]?.trim() || source.title; const year = source.issuedDate.slice(0, 4) || (locale.startsWith("de") ? "o. J." : "n.d."); const label = `(${author}, ${year}${locator ? `, ${locale.startsWith("de") ? "S." : "p."} ${locator}` : ""})`; editor.chain().focus().insertContent({ type: "citation", attrs: { items: [{ sourceId: source.id, locator: locator || undefined, locatorType: "page" }], label } }).run(); onOpenChange(false); setLocator(""); setQuery(""); }
  return <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("insertCitation")} />}><BookMarked className="size-4" /></PopoverTrigger><PopoverContent className="w-80 p-2"><div className="grid grid-cols-[1fr_5rem] gap-2"><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("findSource")} className="h-8" /><Input value={locator} onChange={(event) => setLocator(event.target.value)} placeholder={t("pageShort")} className="h-8" /></div><div className="mt-2 max-h-64 overflow-y-auto">{sources.filter((source) => `${source.title} ${source.contributors}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((source) => <button key={source.id} type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => insert(source)}><span className="block text-sm font-medium">{source.title}</span><span className="text-xs text-muted-foreground">{source.contributors || "—"} · {source.issuedDate.slice(0,4) || "—"}</span></button>)}</div></PopoverContent></Popover>;
}

type EvidenceRef = {
  id: string;
  sourceId: string;
  documentId: string;
  pageNumber: number;
  kind: string;
  selectedText: string;
  note: string;
  label: string;
  sourceTitle: string;
};

function EvidencePicker({ editor, pageId, locale, open, onOpenChange }: { editor: Editor; pageId: string; locale: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("wiki");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<EvidenceRef[]>([]);
  const [loading, setLoading] = useState(false);

  async function load(search = "") {
    setLoading(true);
    try {
      const response = await fetch(`/api/wiki/evidence?targetType=wikiPage&targetId=${encodeURIComponent(pageId)}&q=${encodeURIComponent(search)}`);
      if (response.ok) {
        const body = await response.json() as { available: EvidenceRef[] };
        setItems(body.available);
      }
    } finally {
      setLoading(false);
    }
  }

  function insert(item: EvidenceRef) {
    const pageLabel = locale.startsWith("de") ? "S." : "p.";
    editor.chain().focus().insertContent([
      {
        type: "pdfEvidence",
        attrs: {
          nodeId: crypto.randomUUID(),
          annotationId: item.id,
          sourceId: item.sourceId,
          documentId: item.documentId,
          pageNumber: item.pageNumber,
          kind: item.kind,
          quote: item.selectedText,
          label: item.label || item.note,
          sourceTitle: item.sourceTitle,
          previewUrl: item.kind === "region" ? "/api/wiki/pdf-annotations/" + item.id + "/preview" : "",
        },
      },
      {
        type: "paragraph",
        content: [{
          type: "citation",
          attrs: {
            items: [{ sourceId: item.sourceId, annotationId: item.id, locator: String(item.pageNumber), locatorType: "page" }],
            label: `(${item.sourceTitle}, ${pageLabel} ${item.pageNumber})`,
          },
        }],
      },
    ]).run();
    onOpenChange(false);
    setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={(value) => { onOpenChange(value); if (value) void load(); }}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("insertPdfEvidence")} />}>
        <Highlighter className="size-4 text-indigo-600" />
      </PopoverTrigger>
      <PopoverContent className="w-96 p-2">
        <div className="flex gap-2">
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query); }} placeholder={t("findEvidence")} className="h-8" />
          <Button type="button" size="sm" onClick={() => void load(query)}>{t("search")}</Button>
        </div>
        <div className="mt-2 max-h-72 overflow-y-auto">
          {loading ? <p className="p-3 text-sm text-muted-foreground">{t("loading")}</p> : items.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{t("noEvidenceAvailable")}</p> : items.map((item) => (
            <button key={item.id} type="button" className="block w-full rounded px-2 py-2 text-left hover:bg-accent" onClick={() => insert(item)}>
              <span className="block text-sm font-medium">{item.label || item.sourceTitle} · {t("pageNumber", { page: item.pageNumber })}</span>
              {item.selectedText && <span className="mt-1 line-clamp-3 block text-xs italic text-muted-foreground">“{item.selectedText}”</span>}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function openExternalLink(editor: Editor) {
  const previous = editor.getAttributes("link").href as string | undefined;
  const url = prompt("URL", previous ?? "https://");
  if (url === null) return;
  if (!url) editor.chain().focus().unsetLink().run();
  else editor.chain().focus().setLink({ href: url }).run();
}

export function WikiEditor({ focused = false, pageId, pageVersion, initialContent, allPages, sources, users, citationLocale, comments, pageActions }: { focused?: boolean; pageId: string; pageVersion: number; initialContent: string; allPages: PageRef[]; sources: SourceRef[]; users: Array<{ id: string; name: string }>; citationLocale: string; comments: CommentThread[]; pageActions: WikiEditorPageActions }) {
  const t = useTranslations("wiki"); const router = useRouter(); const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "conflict">("idle");
  const [conflictRevision, setConflictRevision] = useState<string | null>(null); const [activeThreadId, setActiveThreadId] = useState<string | null>(null); const [commentFocusRequest, setCommentFocusRequest] = useState(0); const [imagePickerRequest, setImagePickerRequest] = useState(0); const [commentOpen, setCommentOpen] = useState(false); const [commentBody, setCommentBody] = useState(""); const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null); const [composerPosition, setComposerPosition] = useState<{ left: number; top: number; above: boolean } | null>(null); const [regionTarget, setRegionTarget] = useState<{ nodeId: string; label: string } | null>(null); const [imageError, setImageError] = useState(""); const [imageUploading, setImageUploading] = useState(false); const [assigneeId, setAssigneeId] = useState("none");
  const [pageLinkOpen, setPageLinkOpen] = useState(false); const [citationOpen, setCitationOpen] = useState(false); const [evidenceOpen, setEvidenceOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const version = useRef(pageVersion); const lastServerContent = useRef(initialContent); const conflictBlocked = useRef(false); const selection = useRef<{ from: number; to: number } | null>(null); const imageInputRef = useRef<HTMLInputElement>(null); const editorRootRef = useRef<HTMLDivElement>(null); const commentRailRef = useRef<CommentRailHandle>(null); const [commentsVisible, setCommentsVisible] = useState(!focused); const previousFocused = useRef(focused); const storageKey = `wiki-draft:${pageId}`;
  let content: object | undefined; try { content = initialContent ? JSON.parse(initialContent) : undefined; } catch { content = undefined; }
  if (typeof window !== "undefined") { const draft = window.localStorage.getItem(storageKey); if (draft && draft !== initialContent) { try { content = JSON.parse(draft); } catch { /* ignore damaged recovery */ } } }

  const group = (name: "text" | "lists" | "blocks" | "wiki") => t("slash.groups." + name);
  const slash = (id: string, groupName: "text" | "lists" | "blocks" | "wiki", icon: SlashCommandDefinition["icon"], execute: SlashCommandDefinition["execute"]): SlashCommandDefinition => ({ id, group: groupName, groupLabel: group(groupName), icon, execute, label: t("slash.commands." + id + ".label"), description: t("slash.commands." + id + ".description"), keywords: t.raw("slash.commands." + id + ".keywords") as string[] });
  const slashCommands: SlashCommandDefinition[] = [
    slash("paragraph", "text", AlignLeft, (editor) => editor.chain().focus().setParagraph().run()),
    slash("heading1", "text", Heading1, (editor) => editor.chain().focus().setHeading({ level: 1 }).run()),
    slash("heading2", "text", Heading2, (editor) => editor.chain().focus().setHeading({ level: 2 }).run()),
    slash("heading3", "text", Heading3, (editor) => editor.chain().focus().setHeading({ level: 3 }).run()),
    slash("bulletList", "lists", List, (editor) => editor.chain().focus().toggleBulletList().run()),
    slash("orderedList", "lists", ListOrdered, (editor) => editor.chain().focus().toggleOrderedList().run()),
    slash("taskList", "lists", ListTodo, (editor) => editor.chain().focus().toggleTaskList().run()),
    slash("blockquote", "blocks", Quote, (editor) => editor.chain().focus().toggleBlockquote().run()),
    slash("codeBlock", "blocks", Code, (editor) => editor.chain().focus().toggleCodeBlock().run()),
    slash("horizontalRule", "blocks", Minus, (editor) => editor.chain().focus().setHorizontalRule().run()),
    slash("pageLink", "wiki", Link2, () => setPageLinkOpen(true)),
    slash("externalLink", "wiki", Link2, (editor) => openExternalLink(editor)),
    slash("citation", "wiki", BookMarked, () => setCitationOpen(true)),
    slash("pdfEvidence", "wiki", Highlighter, () => setEvidenceOpen(true)),
    slash("inlineImage", "wiki", ImagePlus, () => setImagePickerRequest((value) => value + 1)),
    slash("attachment", "wiki", Paperclip, () => pageActions.addAttachment()),
    slash("supportingSource", "wiki", BookMarked, () => pageActions.linkSupportingSource()),
    slash("pageComment", "wiki", MessageSquareText, () => setCommentFocusRequest((value) => value + 1)),
  ];
  const slashExtension = createSlashCommandExtension({ commands: slashCommands, ariaLabel: t("slash.ariaLabel"), emptyLabel: t("slash.empty") });

  const editor = useEditor({ immediatelyRender: false, extensions: [StarterKit.configure({ link: { openOnClick: false } }), TaskList, TaskItem.configure({ nested: true }), Citation, PdfEvidence, CommentableImage, CommentMark, Highlight, slashExtension], content,
    editorProps: {
      attributes: { class: "prose prose-neutral dark:prose-invert max-w-none min-h-[28rem] focus:outline-none text-[15px] leading-7" },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((file) => INLINE_IMAGE_TYPES.has(file.type));
        if (!files.length) return false;
        event.preventDefault();
        void (async () => {
          let position = view.state.selection.from;
          for (const file of files) {
            const attachment = await uploadInlineAttachment(pageId, file);
            const node = view.state.schema.nodes.commentableImage.create(imageNodeAttrs(attachment));
            view.dispatch(view.state.tr.insert(position, node));
            position += node.nodeSize;
          }
          router.refresh();
        })().catch((error: unknown) => setImageError(error instanceof Error ? error.message : t("uploadFailed")));
        return true;
      },
      handleDrop(view, event) {
        const files = [...(event.dataTransfer?.files ?? [])].filter((file) => INLINE_IMAGE_TYPES.has(file.type));
        if (!files.length) return false;
        event.preventDefault();
        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void (async () => {
          let position = coordinates?.pos ?? view.state.selection.from;
          for (const file of files) {
            const attachment = await uploadInlineAttachment(pageId, file);
            const node = view.state.schema.nodes.commentableImage.create(imageNodeAttrs(attachment));
            view.dispatch(view.state.tr.insert(position, node));
            position += node.nodeSize;
          }
          router.refresh();
        })().catch((error: unknown) => setImageError(error instanceof Error ? error.message : t("uploadFailed")));
        return true;
      },
    },
    onCreate({ editor }) { backfillCommentNodeIds(editor); },
    onUpdate({ editor }) {
      const json = JSON.stringify(editor.getJSON());
      localStorage.setItem(storageKey, json);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (conflictBlocked.current) { setSaveState("conflict"); return; }
      setSaveState("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          let result = await savePageContent({ id: pageId, contentJson: json, baseContentJson: lastServerContent.current, expectedVersion: version.current });
          if (!result.saved && result.conflict && result.contentJson === lastServerContent.current) {
            version.current = result.version;
            result = await savePageContent({ id: pageId, contentJson: json, baseContentJson: lastServerContent.current, expectedVersion: version.current });
          }
          if (result.saved) {
            version.current = result.version ?? version.current;
            lastServerContent.current = json;
            conflictBlocked.current = false;
            localStorage.removeItem(storageKey);
            setConflictRevision(null);
            setSaveState("saved");
          } else if (result.conflict) {
            version.current = result.version;
            conflictBlocked.current = true;
            setConflictRevision(result.revisionId);
            setSaveState("conflict");
          }
        } catch { setSaveState("idle"); }
      }, 800);
    },
  });

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    if (previousFocused.current === focused) return;
    previousFocused.current = focused;
    setCommentsVisible(!focused);
  }, [focused]);
  useEffect(() => { if (!conflictBlocked.current && pageVersion > version.current) version.current = pageVersion; }, [pageVersion]);
  useEffect(() => { if (commentFocusRequest > 0) commentRailRef.current?.focusGeneralComment(); }, [commentFocusRequest]);
  useEffect(() => { if (imagePickerRequest > 0) imageInputRef.current?.click(); }, [imagePickerRequest]);
  if (!editor) return <div className="min-h-[28rem]" />;
  const activeEditor = editor;
  function externalLink() { openExternalLink(activeEditor); }
  function commentPosition(anchor: CommentAnchor) {
    if (window.innerWidth < 640) return null;
    let rect: { left: number; right: number; top: number; bottom: number } | null = null;
    if (anchor.type === "text" && selection.current) {
      const start = activeEditor.view.coordsAtPos(selection.current.from);
      const end = activeEditor.view.coordsAtPos(selection.current.to);
      rect = { left: Math.min(start.left, end.left), right: Math.max(start.right, end.right), top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom) };
    } else if (anchor.type === "image") {
      const container = [...(editorRootRef.current?.querySelectorAll<HTMLElement>("[data-comment-node-id]") ?? [])].find((element) => element.dataset.commentNodeId === anchor.nodeId);
      rect = (container?.querySelector("img") ?? container)?.getBoundingClientRect() ?? null;
    }
    if (!rect) return null;
    const above = rect.top > 340;
    return {
      left: Math.min(window.innerWidth - 224, Math.max(224, (rect.left + rect.right) / 2)),
      top: above ? rect.top - 12 : rect.bottom + 12,
      above,
    };
  }
  function openCommentComposer(anchor: CommentAnchor) {
    setPendingAnchor(anchor);
    setComposerPosition(commentPosition(anchor));
    requestAnimationFrame(() => setCommentOpen(true));
  }
  function prepareComment() {
    const { from, to, empty } = activeEditor.state.selection;
    if (empty) return;
    selection.current = { from, to };
    openCommentComposer({ type: "text", quote: activeEditor.state.doc.textBetween(from, to, " ") });
  }
  function selectedImage() {
    const current = activeEditor.state.selection;
    if (!(current instanceof NodeSelection) || !["commentableImage", "pdfEvidence"].includes(current.node.type.name)) return null;
    return {
      nodeId: current.node.attrs.nodeId as string,
      label: (current.node.attrs.caption || current.node.attrs.alt || current.node.attrs.label || current.node.attrs.quote || current.node.attrs.sourceTitle || t("image")) as string,
    };
  }
  function prepareImageComment(mode: "whole" | "region") {
    const image = selectedImage();
    if (!image) return;
    if (mode === "region") setRegionTarget(image);
    else openCommentComposer({ type: "image", ...image, mode: "whole" });
  }
  async function insertInlineImage(file: File) {
    if (!INLINE_IMAGE_TYPES.has(file.type)) { setImageError(t("inlineImageUnsupported")); return; }
    setImageUploading(true); setImageError("");
    try {
      const attachment = await uploadInlineAttachment(pageId, file);
      activeEditor.chain().focus().insertContent({ type: "commentableImage", attrs: imageNodeAttrs(attachment) }).run();
      router.refresh();
    } catch (error) {
      setImageError(error instanceof Error ? error.message : t("uploadFailed"));
    } finally {
      setImageUploading(false);
    }
  }
  async function submitComment() {
    if (!pendingAnchor || !commentBody.trim()) return;
    const result = await addComment({ pageId, body: commentBody, anchor: pendingAnchor, assigneeId: assigneeId === "none" ? null : assigneeId });
    if (pendingAnchor.type === "text" && selection.current) addThreadMark(activeEditor, selection.current, result.threadId);
    setActiveThreadId(result.threadId);
    commentRailRef.current?.openMobile();
    setCommentOpen(false);
    setCommentBody("");
    setPendingAnchor(null);
    setAssigneeId("none");
    selection.current = null;
    router.refresh();
  }
  function discardDraftAndReload() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    localStorage.removeItem(storageKey);
    location.reload();
  }
  async function restoreConflictDraft() {
    if (!conflictRevision) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await restorePageRevision(conflictRevision);
    localStorage.removeItem(storageKey);
    location.reload();
  }

  return <div className="relative flex flex-col gap-3"><div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur">
    <ToolbarButton title="Bold" active={activeEditor.isActive("bold")} onClick={() => activeEditor.chain().focus().toggleBold().run()}><Bold className="size-4" /></ToolbarButton><ToolbarButton title="Italic" active={activeEditor.isActive("italic")} onClick={() => activeEditor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></ToolbarButton><ToolbarButton title="Underline" active={activeEditor.isActive("underline")} onClick={() => activeEditor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="size-4" /></ToolbarButton><ToolbarButton title="Highlight" active={activeEditor.isActive("highlight")} onClick={() => activeEditor.chain().focus().toggleMark("highlight").run()}><Highlighter className="size-4" /></ToolbarButton><ToolbarButton title="Strikethrough" active={activeEditor.isActive("strike")} onClick={() => activeEditor.chain().focus().toggleStrike().run()}><Strikethrough className="size-4" /></ToolbarButton><span className="mx-1 h-5 w-px bg-border" />
    {[1,2,3].map((level) => { const Icon = level === 1 ? Heading1 : level === 2 ? Heading2 : Heading3; return <ToolbarButton key={level} title={`H${level}`} active={activeEditor.isActive("heading", { level })} onClick={() => activeEditor.chain().focus().toggleHeading({ level: level as 1|2|3 }).run()}><Icon className="size-4" /></ToolbarButton>; })}<span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton title="Bullet list" active={activeEditor.isActive("bulletList")} onClick={() => activeEditor.chain().focus().toggleBulletList().run()}><List className="size-4" /></ToolbarButton><ToolbarButton title="Ordered list" active={activeEditor.isActive("orderedList")} onClick={() => activeEditor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></ToolbarButton><ToolbarButton title="Task list" active={activeEditor.isActive("taskList")} onClick={() => activeEditor.chain().focus().toggleTaskList().run()}><ListTodo className="size-4" /></ToolbarButton><ToolbarButton title="Blockquote" active={activeEditor.isActive("blockquote")} onClick={() => activeEditor.chain().focus().toggleBlockquote().run()}><Quote className="size-4" /></ToolbarButton><ToolbarButton title="Code block" active={activeEditor.isActive("codeBlock")} onClick={() => activeEditor.chain().focus().toggleCodeBlock().run()}><Code className="size-4" /></ToolbarButton><span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton title={t("insertLink")} active={activeEditor.isActive("link")} onClick={externalLink}><Link2 className="size-4 rotate-45" /></ToolbarButton><PageLinkPicker editor={editor} pages={allPages} open={pageLinkOpen} onOpenChange={setPageLinkOpen} /><CitationPicker editor={editor} sources={sources} locale={citationLocale} open={citationOpen} onOpenChange={setCitationOpen} /><EvidencePicker editor={editor} pageId={pageId} locale={citationLocale} open={evidenceOpen} onOpenChange={setEvidenceOpen} /><ToolbarButton title={t("insertImage")} onClick={() => imageInputRef.current?.click()}><ImagePlus className="size-4" /></ToolbarButton><input ref={imageInputRef} data-testid="wiki-inline-image-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertInlineImage(file); event.target.value = ""; }} /><ToolbarButton title={t("inlineComment")} onClick={prepareComment}><MessageSquareText className="size-4" /></ToolbarButton><ToolbarButton title={commentsVisible ? t("hideComments") : t("showComments")} aria-label={commentsVisible ? t("hideComments") : t("showComments")} onClick={() => setCommentsVisible((value) => !value)}>{commentsVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</ToolbarButton>
    <span className="ml-auto px-2 text-xs text-muted-foreground">{saveState === "saving" && t("saving")}{saveState === "saved" && t("saved")}{saveState === "conflict" && <span className="text-amber-700">{t("editConflict")}</span>}</span>
  </div>
  {imageUploading && <p className="text-xs text-muted-foreground">{t("uploadingImage")}</p>}
  {imageError && <p className="text-xs text-destructive">{imageError}</p>}
  {saveState === "conflict" && conflictRevision && <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><RotateCcw className="size-4" /><span className="flex-1">{t("editConflictDescription")}</span><Button size="sm" variant="outline" onClick={discardDraftAndReload}>{t("loadCurrent")}</Button><Button size="sm" onClick={() => void restoreConflictDraft()}>{t("restoreMine")}</Button></div>}
  <div className={commentsVisible ? focused ? "grid items-start justify-center gap-8 xl:grid-cols-[minmax(0,56rem)_18rem]" : "grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]" : focused ? "mx-auto max-w-4xl" : "block"}>
    <div ref={editorRootRef} className="relative min-w-0">
      <BubbleMenu editor={editor} pluginKey="wikiTextCommentMenu" options={{ strategy: "fixed", flip: true, shift: true, offset: 8 }} shouldShow={({ state }) => !state.selection.empty && !(state.selection instanceof NodeSelection)} className="z-40 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
        <Button type="button" size="sm" variant={activeEditor.isActive("highlight") ? "secondary" : "ghost"} onClick={() => activeEditor.chain().focus().toggleMark("highlight").run()}><Highlighter className="size-4" />{t("highlightSelection")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={prepareComment}><MessageSquareText className="size-4" />{t("commentSelection")}</Button>
      </BubbleMenu>
      <BubbleMenu editor={editor} pluginKey="wikiImageCommentMenu" options={{ strategy: "fixed", placement: "bottom", flip: true, shift: true, offset: 8 }} shouldShow={({ state }) => state.selection instanceof NodeSelection && ["commentableImage", "pdfEvidence"].includes(state.selection.node.type.name)} className="z-40 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
        <Button type="button" size="sm" variant="ghost" onClick={() => prepareImageComment("whole")}><MessageSquareText className="size-4" />{t("commentWholeImage")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => prepareImageComment("region")}><Scan className="size-4" />{t("selectImageRegion")}</Button>
      </BubbleMenu>
      <EditorContent editor={editor} data-testid="wiki-editor" />
      <CommentAnchorOverlay visible={commentsVisible} comments={comments} editor={editor} rootRef={editorRootRef} activeThreadId={activeThreadId} />
    </div>
    <CommentRail ref={commentRailRef} visible={commentsVisible} onVisibleChange={setCommentsVisible} pageId={pageId} comments={comments} editor={editor} editorRootRef={editorRootRef} activeThreadId={activeThreadId} onActiveThreadChange={setActiveThreadId} />
  </div>
  {regionTarget && <ImageRegionSelector rootRef={editorRootRef} {...regionTarget} onCancel={() => setRegionTarget(null)} onSelect={(anchor) => { setRegionTarget(null); openCommentComposer(anchor); }} />}
  <Dialog open={commentOpen} onOpenChange={(open) => { setCommentOpen(open); if (!open) { setPendingAnchor(null); setComposerPosition(null); } }}><DialogContent className="w-[min(26rem,calc(100vw-2rem))]" style={composerPosition ? { left: composerPosition.left, top: composerPosition.top, transform: `translate(-50%, ${composerPosition.above ? "-100%" : "0"})` } : undefined}><DialogHeader><DialogTitle>{pendingAnchor?.type === "image" ? t("imageComment") : t("inlineComment")}</DialogTitle></DialogHeader>{pendingAnchor?.type !== "page" && pendingAnchor && <blockquote className="border-l-2 border-amber-400 pl-3 text-sm italic text-muted-foreground">{pendingAnchor.type === "text" ? pendingAnchor.quote : pendingAnchor.label}</blockquote>}<Textarea autoFocus value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder={t("commentPlaceholder")} /><Select value={assigneeId} onValueChange={(value) => setAssigneeId(value ?? "none")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("unassigned")}</SelectItem>{users.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select><Button onClick={submitComment} disabled={!commentBody.trim()}>{t("addComment")}</Button></DialogContent></Dialog>
  </div>;
}
