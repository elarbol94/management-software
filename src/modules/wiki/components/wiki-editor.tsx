"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Fragment, Slice } from "@tiptap/pm/model";
import { AlertCircle, AlignCenter, AlignLeft, AlignRight, Bold, BookMarked, Check, CloudOff, Code, Columns2, Eye, EyeOff, FileText, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, ListTree, ListTodo, MessageSquareText, Minus, MoreHorizontal, Paperclip, Pilcrow, Quote, Redo2, RotateCcw, Rows3, Scan, ScissorsLineDashed, Search, Settings2, Strikethrough, Trash2, Underline as UnderlineIcon, Undo2, WifiOff } from "lucide-react";
import { savePageContent } from "../actions";
import { addComment, restorePageRevision } from "../research-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createSlashCommandExtension, type SlashCommandDefinition } from "./slash-command-menu";
import { CommentRail, type CommentRailHandle, type CommentThread } from "./comment-rail";
import { CommentAnchorOverlay } from "./comment-anchor-overlay";
import { MarkdownDocumentExtensions, MarkdownShortcutMarks, MarkdownShortcuts } from "./markdown-shortcut-extension";
import { MarkdownReferenceDialog } from "./markdown-reference-dialog";
import { EditorLinkPopover, EditorOutlineSheet, EditorSearchPanel, type OutlineItem } from "./editor-tools";
import { mergeCommentThreadIds, normalizeImageRect, type CommentAnchor } from "../lib/comment-anchors";
import { EditorSearchExtension } from "../lib/editor-search";
import { looksLikeMarkdown, parseMarkdownDocument } from "../lib/markdown-import";
import { calculateWritingStats, type WritingStats } from "../lib/editor-writing";
import { userMarkColorStyle, type UserMarkColor } from "@/lib/user-mark-colors";
import { DocumentExtensions } from "./document-extension";
import { DocumentLayoutPanel } from "./document-layout-panel";
import {
  collectDocumentPreflightIssues,
  parseDocumentSettings,
  serializeDocumentSettings,
  type DocumentPreflightIssue,
  type DocumentSettingsV1,
} from "../lib/document-settings";
import type { StoredDocumentTemplate } from "../document-queries";
import {
  addMarkdownTableColumn,
  addMarkdownTableRow,
  deleteMarkdownTableColumn,
  deleteMarkdownTableRow,
  setMarkdownTableCellAlignment,
  toggleMarkdownTableHeader,
} from "../lib/document-table";

type PageRef = { id: string; title: string; slug: string };
type SourceRef = { id: string; title: string; issuedDate: string; contributors: string };
type WikiEditorPageActions = { addAttachment: () => void; linkSupportingSource: () => void };
type EditorPreferences = { statusVisible: boolean; minimalToolbar: boolean; typewriterMode: boolean };
type WikiEditorProps = {
  focused?: boolean;
  pageId: string;
  pageVersion: number;
  initialContent: string;
  initialDocumentMode: boolean;
  initialDocumentSettings: string;
  documentTemplates: StoredDocumentTemplate[];
  allPages: PageRef[];
  sources: SourceRef[];
  users: Array<{ id: string; name: string; markColor: UserMarkColor }>;
  citationLocale: string;
  comments: CommentThread[];
  currentUserId: string;
  pageActions: WikiEditorPageActions;
};

function loadEditorPreferences(): EditorPreferences {
  if (typeof window === "undefined") return { statusVisible: true, minimalToolbar: false, typewriterMode: false };
  try {
    const stored = JSON.parse(localStorage.getItem("wiki-editor-preferences") ?? "{}") as Partial<EditorPreferences>;
    return { statusVisible: stored.statusVisible ?? true, minimalToolbar: stored.minimalToolbar ?? false, typewriterMode: stored.typewriterMode ?? false };
  } catch {
    return { statusVisible: true, minimalToolbar: false, typewriterMode: false };
  }
}

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
      widthPercent: { default: 100 },
      alignment: { default: "center" },
      cropX: { default: 50 },
      cropY: { default: 50 },
    };
  },
  parseHTML() { return [{ tag: "figure[data-commentable-image]" }]; },
  renderHTML({ HTMLAttributes }) {
    const label = HTMLAttributes.caption || HTMLAttributes.alt || "Image";
    return ["figure", {
      "data-commentable-image": "",
      "data-comment-node-id": HTMLAttributes.nodeId,
      "data-attachment-id": HTMLAttributes.attachmentId,
      "data-image-alignment": HTMLAttributes.alignment,
      class: "wiki-commentable-media my-5",
      style: `width:${Math.max(20, Math.min(100, Number(HTMLAttributes.widthPercent) || 100))}%;margin-left:${HTMLAttributes.alignment === "right" ? "auto" : HTMLAttributes.alignment === "center" ? "auto" : "0"};margin-right:${HTMLAttributes.alignment === "left" ? "auto" : HTMLAttributes.alignment === "center" ? "auto" : "0"}`,
    }, ["img", { src: HTMLAttributes.src, alt: HTMLAttributes.alt || label, class: "max-h-[36rem] w-full rounded-lg object-contain", style: `object-position:${Number(HTMLAttributes.cropX) || 50}% ${Number(HTMLAttributes.cropY) || 50}%` }],
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
  addAttributes() {
    return {
      createdBy: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-highlight-author"),
        renderHTML: (attributes) => attributes.createdBy ? { "data-highlight-author": attributes.createdBy } : {},
      },
    };
  },
  parseHTML() { return [{ tag: "mark:not([data-comment-thread])" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", mergeAttributes(HTMLAttributes, { class: "wiki-highlight" }), 0]; },
});

function ToolbarButton({ active, onClick, title, shortcut, children }: { active?: boolean; onClick: () => void; title: string; shortcut?: string; children: React.ReactNode }) {
  return <Tooltip>
    <TooltipTrigger render={<Button type="button" variant={active ? "secondary" : "ghost"} size="icon-sm" aria-label={title} aria-pressed={active} onMouseDown={(event) => event.preventDefault()} onClick={onClick} />}>{children}</TooltipTrigger>
    <TooltipContent>{title}{shortcut && <kbd className="ml-1 rounded bg-background/15 px-1 py-0.5 font-mono">{shortcut}</kbd>}</TooltipContent>
  </Tooltip>;
}

function ToolbarMenu({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" className="gap-1 px-2" aria-label={label} />}>{icon}<span className="hidden text-xs sm:inline">{label}</span></DropdownMenuTrigger>
    <DropdownMenuContent className="w-56">{children}</DropdownMenuContent>
  </DropdownMenu>;
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
    widthPercent: 100,
    alignment: "center",
    cropX: 50,
    cropY: 50,
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
  return <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("linkPage")} aria-label={t("linkPage")} />}><Link2 className="size-4" /></PopoverTrigger><PopoverContent className="w-72 p-2"><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filterPages")} className="mb-2 h-8" /><div className="max-h-60 overflow-y-auto">{pages.filter((page) => page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((page) => <button key={page.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { const { empty } = editor.state.selection; const href = `/wiki/pages/${page.slug}`; if (empty) editor.chain().focus().insertContent({ type: "text", text: page.title, marks: [{ type: "link", attrs: { href } }] }).run(); else editor.chain().focus().setLink({ href }).run(); onOpenChange(false); }}>{page.title}</button>)}</div></PopoverContent></Popover>;
}

function CitationPicker({ editor, sources, locale, open, onOpenChange }: { editor: Editor; sources: SourceRef[]; locale: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("wiki"); const [query, setQuery] = useState(""); const [locator, setLocator] = useState("");
  function insert(source: SourceRef) { const author = source.contributors.split(",")[0]?.trim() || source.title; const year = source.issuedDate.slice(0, 4) || (locale.startsWith("de") ? "o. J." : "n.d."); const label = `(${author}, ${year}${locator ? `, ${locale.startsWith("de") ? "S." : "p."} ${locator}` : ""})`; editor.chain().focus().insertContent({ type: "citation", attrs: { items: [{ sourceId: source.id, locator: locator || undefined, locatorType: "page" }], label } }).run(); onOpenChange(false); setLocator(""); setQuery(""); }
  return <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("insertCitation")} aria-label={t("insertCitation")} />}><BookMarked className="size-4" /></PopoverTrigger><PopoverContent className="w-80 p-2"><div className="grid grid-cols-[1fr_5rem] gap-2"><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("findSource")} className="h-8" /><Input value={locator} onChange={(event) => setLocator(event.target.value)} placeholder={t("pageShort")} className="h-8" /></div><div className="mt-2 max-h-64 overflow-y-auto">{sources.filter((source) => `${source.title} ${source.contributors}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((source) => <button key={source.id} type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => insert(source)}><span className="block text-sm font-medium">{source.title}</span><span className="text-xs text-muted-foreground">{source.contributors || "—"} · {source.issuedDate.slice(0,4) || "—"}</span></button>)}</div></PopoverContent></Popover>;
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
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("insertPdfEvidence")} aria-label={t("insertPdfEvidence")} />}>
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

export function WikiEditor({
  focused = false,
  pageId,
  pageVersion,
  initialContent,
  initialDocumentMode,
  initialDocumentSettings,
  documentTemplates,
  allPages,
  sources,
  users,
  citationLocale,
  comments,
  currentUserId,
  pageActions,
}: WikiEditorProps) {
  const t = useTranslations("wiki"); const router = useRouter(); const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved" | "offline" | "error" | "conflict">("idle");
  const [conflictRevision, setConflictRevision] = useState<string | null>(null); const [activeThreadId, setActiveThreadId] = useState<string | null>(null); const [optimisticCommentThreads, setOptimisticCommentThreads] = useState<CommentThread[]>([]); const [commentFocusRequest, setCommentFocusRequest] = useState(0); const [imagePickerRequest, setImagePickerRequest] = useState(0); const [commentOpen, setCommentOpen] = useState(false); const [commentBody, setCommentBody] = useState(""); const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null); const [regionTarget, setRegionTarget] = useState<{ nodeId: string; label: string } | null>(null); const [imageError, setImageError] = useState(""); const [imageUploading, setImageUploading] = useState(false); const [assigneeId, setAssigneeId] = useState("none");
  const commentThreads = useMemo(
    () => [...optimisticCommentThreads.filter((thread) => !comments.some((item) => item.id === thread.id)), ...comments],
    [comments, optimisticCommentThreads],
  );
  const [pageLinkOpen, setPageLinkOpen] = useState(false); const [citationOpen, setCitationOpen] = useState(false); const [evidenceOpen, setEvidenceOpen] = useState(false); const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false); const [linkEditorRequest, setLinkEditorRequest] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false); const [outlineOpen, setOutlineOpen] = useState(false); const [outline, setOutline] = useState<OutlineItem[]>([]); const [activeHeadingPosition, setActiveHeadingPosition] = useState<number | null>(null);
  const [writingStats, setWritingStats] = useState<WritingStats>({ words: 0, characters: 0, selectedWords: 0, readingMinutes: 0 });
  const [documentMode, setDocumentMode] = useState(initialDocumentMode);
  const [documentSettings, setDocumentSettings] = useState<DocumentSettingsV1>(() => parseDocumentSettings(initialDocumentSettings));
  const [documentIssues, setDocumentIssues] = useState<DocumentPreflightIssue[]>([]);
  const [initialPreferences] = useState(loadEditorPreferences);
  const [statusVisible, setStatusVisible] = useState(initialPreferences.statusVisible); const [minimalToolbar, setMinimalToolbar] = useState(initialPreferences.minimalToolbar); const [typewriterMode, setTypewriterMode] = useState(initialPreferences.typewriterMode); const typewriterModeRef = useRef(initialPreferences.typewriterMode);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const version = useRef(pageVersion); const lastServerContent = useRef(initialContent); const lastServerDocumentMode = useRef(initialDocumentMode); const lastServerDocumentSettings = useRef(serializeDocumentSettings(parseDocumentSettings(initialDocumentSettings))); const documentModeRef = useRef(initialDocumentMode); const documentSettingsRef = useRef(parseDocumentSettings(initialDocumentSettings)); const pendingSave = useRef<string | null>(null); const persistContentRef = useRef<(json: string) => Promise<void>>(async () => {}); const conflictBlocked = useRef(false); const selection = useRef<{ from: number; to: number } | null>(null); const imageInputRef = useRef<HTMLInputElement>(null); const editorRootRef = useRef<HTMLDivElement>(null); const commentRailRef = useRef<CommentRailHandle>(null); const [commentsVisible, setCommentsVisible] = useState(!focused); const previousFocused = useRef(focused); const storageKey = `wiki-draft:${pageId}`; const preferencesKey = `wiki-editor-preferences`;
  let content: object | undefined; try { content = initialContent ? JSON.parse(initialContent) : undefined; } catch { content = undefined; }
  if (typeof window !== "undefined") { const draft = window.localStorage.getItem(storageKey); if (draft && draft !== initialContent) { try { content = JSON.parse(draft); } catch { /* ignore damaged recovery */ } } }

  function updateDerivedState(currentEditor: Editor) {
    const items: OutlineItem[] = [];
    currentEditor.state.doc.descendants((node, position) => {
      if (node.type.name === "heading") items.push({ level: Number(node.attrs.level), text: node.textContent, position, id: String(node.attrs.id ?? `heading-${position}`) });
    });
    setOutline(items);
    const cursor = currentEditor.state.selection.from;
    setActiveHeadingPosition([...items].reverse().find((item) => item.position < cursor)?.position ?? null);
    setWritingStats(calculateWritingStats(currentEditor.state.doc, currentEditor.state.selection));
    setDocumentIssues(collectDocumentPreflightIssues(currentEditor.getJSON(), documentSettingsRef.current));
  }

  async function persistContent(json: string, attempt = 0) {
    pendingSave.current = json;
    if (typeof navigator !== "undefined" && !navigator.onLine) { setSaveState("offline"); return; }
    if (conflictBlocked.current) { setSaveState("conflict"); return; }
    setSaveState("saving");
    try {
      const settingsJson = serializeDocumentSettings(documentSettingsRef.current);
      let result = await savePageContent({
        id: pageId,
        contentJson: json,
        baseContentJson: lastServerContent.current,
        documentMode: documentModeRef.current,
        documentSettingsJson: settingsJson,
        baseDocumentMode: lastServerDocumentMode.current,
        baseDocumentSettingsJson: lastServerDocumentSettings.current,
        expectedVersion: version.current,
      });
      if (!result.saved && "conflict" in result && result.conflict
        && result.contentJson === lastServerContent.current
        && result.documentMode === lastServerDocumentMode.current
        && result.documentSettingsJson === lastServerDocumentSettings.current) {
        version.current = result.version;
        result = await savePageContent({
          id: pageId,
          contentJson: json,
          baseContentJson: lastServerContent.current,
          documentMode: documentModeRef.current,
          documentSettingsJson: settingsJson,
          baseDocumentMode: lastServerDocumentMode.current,
          baseDocumentSettingsJson: lastServerDocumentSettings.current,
          expectedVersion: version.current,
        });
      }
      if (result.saved) {
        version.current = result.version ?? version.current;
        lastServerContent.current = json;
        lastServerDocumentMode.current = documentModeRef.current;
        lastServerDocumentSettings.current = settingsJson;
        pendingSave.current = null;
        conflictBlocked.current = false;
        localStorage.removeItem(storageKey);
        setConflictRevision(null);
        setSaveState("saved");
      } else if ("conflict" in result && result.conflict) {
        version.current = result.version;
        conflictBlocked.current = true;
        setConflictRevision(result.revisionId);
        setSaveState("conflict");
      }
    } catch {
      setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      if (attempt < 2) saveTimer.current = setTimeout(() => void persistContent(json, attempt + 1), 1_000 * (2 ** attempt));
    }
  }
  persistContentRef.current = (json: string) => persistContent(json);

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
    slash("pageBreak", "blocks", ScissorsLineDashed, (editor) => editor.chain().focus().insertContent({ type: "pageBreak" }).run()),
    slash("tableOfContents", "blocks", ListTree, (editor) => editor.chain().focus().insertContent({ type: "tableOfContents", attrs: { title: t("document.contents"), maxLevel: 3 } }).run()),
    slash("twoColumns", "blocks", Columns2, (editor) => editor.chain().focus().insertContent({ type: "layoutSection", attrs: { columns: 2, gapMm: 8 }, content: [{ type: "paragraph" }, { type: "paragraph" }] }).run()),
    slash("pageLink", "wiki", Link2, () => setPageLinkOpen(true)),
    slash("externalLink", "wiki", Link2, () => setLinkEditorRequest((value) => value + 1)),
    slash("citation", "wiki", BookMarked, () => setCitationOpen(true)),
    slash("pdfEvidence", "wiki", Highlighter, () => setEvidenceOpen(true)),
    slash("inlineImage", "wiki", ImagePlus, () => setImagePickerRequest((value) => value + 1)),
    slash("attachment", "wiki", Paperclip, () => pageActions.addAttachment()),
    slash("supportingSource", "wiki", BookMarked, () => pageActions.linkSupportingSource()),
    slash("pageComment", "wiki", MessageSquareText, () => setCommentFocusRequest((value) => value + 1)),
  ];
  const slashExtension = createSlashCommandExtension({ commands: slashCommands, ariaLabel: t("slash.ariaLabel"), emptyLabel: t("slash.empty") });

  const editor = useEditor({ immediatelyRender: false, enableInputRules: ["blockquote", "bulletList", "codeBlock", "heading", "orderedList", "taskItem"], extensions: [StarterKit.configure({ bold: false, code: false, heading: { levels: [1, 2, 3] }, italic: false, link: { openOnClick: false }, strike: false }), ...MarkdownShortcutMarks, ...MarkdownDocumentExtensions, ...DocumentExtensions, TaskList, TaskItem.configure({ nested: true }), Citation, PdfEvidence, CommentableImage, CommentMark, Highlight, Placeholder.configure({ placeholder: ({ node }) => node.type.name === "heading" ? t("editor.placeholder.heading") : t("editor.placeholder.empty") }), EditorSearchExtension, MarkdownShortcuts, slashExtension], content,
    editorProps: {
      attributes: { class: "prose prose-neutral dark:prose-invert max-w-none min-h-[28rem] focus:outline-none text-[15px] leading-7" },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((file) => INLINE_IMAGE_TYPES.has(file.type));
        if (files.length) {
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
        }
        const clipboard = event.clipboardData;
        if (!clipboard || clipboard.getData("text/html")) return false;
        const plainText = clipboard.getData("text/plain");
        if (!looksLikeMarkdown(plainText)) return false;
        try {
          const parsed = parseMarkdownDocument(plainText);
          const nodes = (parsed.content ?? []).map((node) => view.state.schema.nodeFromJSON(node));
          event.preventDefault();
          view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)).scrollIntoView());
          return true;
        } catch {
          return false;
        }
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
    onCreate({ editor }) { backfillCommentNodeIds(editor); updateDerivedState(editor); },
    onUpdate({ editor }) {
      updateDerivedState(editor);
      const json = JSON.stringify(editor.getJSON());
      localStorage.setItem(storageKey, json);
      pendingSave.current = json;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (conflictBlocked.current) { setSaveState("conflict"); return; }
      setSaveState("unsaved");
      saveTimer.current = setTimeout(() => void persistContent(json), 800);
    },
    onSelectionUpdate({ editor }) {
      updateDerivedState(editor);
      if (typewriterModeRef.current) editor.view.domAtPos(editor.state.selection.from).node.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
  });

  useEffect(() => {
    if (!editor) return;
    const applyColors = () => {
      const root = editorRootRef.current;
      if (!root) return;
      root.querySelectorAll<HTMLElement>("mark.wiki-highlight").forEach((mark) => {
        const author = users.find((person) => person.id === mark.dataset.highlightAuthor);
        if (!author) return;
        const style = userMarkColorStyle(author.markColor);
        for (const [property, value] of Object.entries(style)) mark.style.setProperty(property, String(value));
      });
    };
    const frame = requestAnimationFrame(applyColors);
    editor.on("update", applyColors);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("update", applyColors);
    };
  }, [currentUserId, editor, users]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    if (previousFocused.current === focused) return;
    previousFocused.current = focused;
    setCommentsVisible(!focused);
  }, [focused]);
  useEffect(() => { if (!conflictBlocked.current && pageVersion > version.current) version.current = pageVersion; }, [pageVersion]);
  useEffect(() => { if (commentFocusRequest > 0) commentRailRef.current?.focusGeneralComment(); }, [commentFocusRequest]);
  useEffect(() => { if (imagePickerRequest > 0) imageInputRef.current?.click(); }, [imagePickerRequest]);
  useEffect(() => {
    typewriterModeRef.current = typewriterMode;
    localStorage.setItem(preferencesKey, JSON.stringify({ statusVisible, minimalToolbar, typewriterMode }));
  }, [minimalToolbar, preferencesKey, statusVisible, typewriterMode]);
  useEffect(() => {
    const online = () => { if (pendingSave.current) void persistContentRef.current(pendingSave.current); };
    const offline = () => { if (pendingSave.current) setSaveState("offline"); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  if (!editor) return <div className="min-h-[28rem]" />;
  const activeEditor = editor;
  function scheduleDocumentSave() {
    const json = JSON.stringify(activeEditor.getJSON());
    pendingSave.current = json;
    localStorage.setItem(storageKey, json);
    setSaveState(conflictBlocked.current ? "conflict" : "unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!conflictBlocked.current) saveTimer.current = setTimeout(() => void persistContent(json), 500);
  }
  function changeDocumentSettings(settings: DocumentSettingsV1) {
    documentSettingsRef.current = settings;
    setDocumentSettings(settings);
    setDocumentIssues(collectDocumentPreflightIssues(activeEditor.getJSON(), settings));
    scheduleDocumentSave();
  }
  function changeDocumentMode(enabled: boolean) {
    documentModeRef.current = enabled;
    setDocumentMode(enabled);
    scheduleDocumentSave();
  }
  const paperWidth = documentSettings.page.size === "A4" ? 210 : 215.9;
  const paperHeight = documentSettings.page.size === "A4" ? 297 : 279.4;
  const documentCanvasStyle = {
    "--document-paper-width": `${documentSettings.page.orientation === "portrait" ? paperWidth : paperHeight}mm`,
    "--document-paper-height": `${documentSettings.page.orientation === "portrait" ? paperHeight : paperWidth}mm`,
    "--document-margin-top": `${documentSettings.page.marginsMm.top}mm`,
    "--document-margin-right": `${documentSettings.page.marginsMm.right}mm`,
    "--document-margin-bottom": `${documentSettings.page.marginsMm.bottom}mm`,
    "--document-margin-left": `${documentSettings.page.marginsMm.left}mm`,
    "--document-body-size": `${documentSettings.theme.bodySizePt}pt`,
    "--document-line-height": String(documentSettings.theme.lineHeight),
    "--document-text-color": documentSettings.theme.textColor,
    "--document-accent-color": documentSettings.theme.accentColor,
    "--document-muted-color": documentSettings.theme.mutedColor,
    "--document-body-font": documentSettings.theme.bodyFont === "serif" ? "Georgia, 'Times New Roman', serif" : documentSettings.theme.bodyFont === "humanist" ? "'Segoe UI', Arial, sans-serif" : "system-ui, sans-serif",
    "--document-heading-font": documentSettings.theme.headingFont === "serif" ? "Georgia, 'Times New Roman', serif" : documentSettings.theme.headingFont === "humanist" ? "'Segoe UI', Arial, sans-serif" : "system-ui, sans-serif",
  } as React.CSSProperties;
  function openCommentComposer(anchor: CommentAnchor) {
    setPendingAnchor(anchor);
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
    setOptimisticCommentThreads((current) => [result.thread, ...current.filter((thread) => thread.id !== result.threadId)]);
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

  const savePresentation = {
    idle: { label: "", icon: null, className: "" },
    unsaved: { label: t("editor.save.unsaved"), icon: <Pilcrow className="size-3.5" />, className: "text-muted-foreground" },
    saving: { label: t("saving"), icon: <RotateCcw className="size-3.5 animate-spin" />, className: "text-muted-foreground" },
    saved: { label: t("saved"), icon: <Check className="size-3.5" />, className: "text-emerald-700 dark:text-emerald-400" },
    offline: { label: t("editor.save.offline"), icon: <WifiOff className="size-3.5" />, className: "text-amber-700 dark:text-amber-400" },
    error: { label: t("editor.save.error"), icon: <AlertCircle className="size-3.5" />, className: "text-destructive" },
    conflict: { label: t("editConflict"), icon: <CloudOff className="size-3.5" />, className: "text-amber-700 dark:text-amber-400" },
  }[saveState];

  return <div className="relative flex flex-col gap-3"><div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur">
    <ToolbarButton title={t("editor.toolbar.undo")} shortcut="Ctrl/⌘ Z" onClick={() => activeEditor.chain().focus().undo().run()}><Undo2 className="size-4" /></ToolbarButton>
    <ToolbarButton title={t("editor.toolbar.redo")} shortcut="Ctrl/⌘ ⇧ Z" onClick={() => activeEditor.chain().focus().redo().run()}><Redo2 className="size-4" /></ToolbarButton>
    <span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton title={t("editor.toolbar.bold")} shortcut="Ctrl/⌘ B" active={activeEditor.isActive("bold")} onClick={() => activeEditor.chain().focus().toggleBold().run()}><Bold className="size-4" /></ToolbarButton>
    <ToolbarButton title={t("editor.toolbar.italic")} shortcut="Ctrl/⌘ I" active={activeEditor.isActive("italic")} onClick={() => activeEditor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></ToolbarButton>
    {!minimalToolbar && <>
      <ToolbarButton title={t("editor.toolbar.heading1")} active={activeEditor.isActive("heading", { level: 1 })} onClick={() => activeEditor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="size-4" /></ToolbarButton>
      <ToolbarButton title={t("editor.toolbar.heading2")} active={activeEditor.isActive("heading", { level: 2 })} onClick={() => activeEditor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="size-4" /></ToolbarButton>
      <ToolbarButton title={t("editor.toolbar.bulletList")} active={activeEditor.isActive("bulletList")} onClick={() => activeEditor.chain().focus().toggleBulletList().run()}><List className="size-4" /></ToolbarButton>
      <ToolbarButton title={t("editor.toolbar.orderedList")} active={activeEditor.isActive("orderedList")} onClick={() => activeEditor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></ToolbarButton>
    </>}
    <ToolbarMenu label={t("editor.toolbar.format")} icon={<MoreHorizontal className="size-4" />}>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("editor.toolbar.format")}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => activeEditor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 />{t("editor.toolbar.heading3")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => activeEditor.chain().focus().toggleUnderline().run()}><UnderlineIcon />{t("editor.toolbar.underline")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => activeEditor.chain().focus().toggleMark("highlight", { createdBy: currentUserId }).run()}><Highlighter />{t("editor.toolbar.highlight")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => activeEditor.chain().focus().toggleStrike().run()}><Strikethrough />{t("editor.toolbar.strike")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => activeEditor.chain().focus().toggleCode().run()}><Code />{t("editor.toolbar.inlineCode")}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => activeEditor.chain().focus().toggleTaskList().run()}><ListTodo />{t("editor.toolbar.taskList")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => activeEditor.chain().focus().toggleBlockquote().run()}><Quote />{t("editor.toolbar.blockquote")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => activeEditor.chain().focus().toggleCodeBlock().run()}><Code />{t("editor.toolbar.codeBlock")}</DropdownMenuItem>
      </DropdownMenuGroup>
    </ToolbarMenu>
    <EditorLinkPopover editor={activeEditor} pages={allPages} request={linkEditorRequest} />
    {!minimalToolbar && <><PageLinkPicker editor={editor} pages={allPages} open={pageLinkOpen} onOpenChange={setPageLinkOpen} /><CitationPicker editor={editor} sources={sources} locale={citationLocale} open={citationOpen} onOpenChange={setCitationOpen} /><EvidencePicker editor={editor} pageId={pageId} locale={citationLocale} open={evidenceOpen} onOpenChange={setEvidenceOpen} /></>}
    <ToolbarMenu label={t("editor.toolbar.insert")} icon={<ImagePlus className="size-4" />}>
      <DropdownMenuItem onClick={() => imageInputRef.current?.click()}><ImagePlus />{t("insertImage")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => activeEditor.chain().focus().setHorizontalRule().run()}><Minus />{t("slash.commands.horizontalRule.label")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => pageActions.addAttachment()}><Paperclip />{t("slash.commands.attachment.label")}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => pageActions.linkSupportingSource()}><BookMarked />{t("slash.commands.supportingSource.label")}</DropdownMenuItem>
    </ToolbarMenu>
    <input ref={imageInputRef} data-testid="wiki-inline-image-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertInlineImage(file); event.target.value = ""; }} />
    <span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton title={t("editor.search.title")} shortcut="Ctrl/⌘ F" active={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search className="size-4" /></ToolbarButton>
    <ToolbarButton title={t("editor.outline.title")} active={outlineOpen} onClick={() => setOutlineOpen(true)}><ListTree className="size-4" /></ToolbarButton>
    <ToolbarButton title={t("inlineComment")} onClick={prepareComment}><MessageSquareText className="size-4" /></ToolbarButton>
    <ToolbarButton title={commentsVisible ? t("hideComments") : t("showComments")} active={commentsVisible} onClick={() => setCommentsVisible((value) => !value)}>{commentsVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</ToolbarButton>
    <Button
      type="button"
      data-testid="document-mode-toggle"
      size="sm"
      variant={documentMode ? "secondary" : "ghost"}
      className="gap-1.5 px-2 text-xs"
      aria-pressed={documentMode}
      onClick={() => changeDocumentMode(!documentMode)}
    >
      <FileText className="size-3.5" />{t("document.toggle")}
    </Button>
    <Button type="button" data-testid="markdown-help-button" size="sm" variant="ghost" className="gap-1.5 px-2 text-xs" onClick={() => setMarkdownHelpOpen(true)}><BookMarked className="size-3.5" />{t("markdownHelp.button")}</Button>
    <ToolbarMenu label={t("editor.preferences.title")} icon={<Settings2 className="size-4" />}>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("editor.preferences.title")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={minimalToolbar} onCheckedChange={(checked) => setMinimalToolbar(checked === true)}>{t("editor.preferences.minimalToolbar")}</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={typewriterMode} onCheckedChange={(checked) => setTypewriterMode(checked === true)}>{t("editor.preferences.typewriter")}</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={statusVisible} onCheckedChange={(checked) => setStatusVisible(checked === true)}>{t("editor.preferences.statusBar")}</DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
    </ToolbarMenu>
    <span role={saveState === "error" || saveState === "conflict" ? "alert" : "status"} aria-live={saveState === "error" || saveState === "conflict" ? "assertive" : "polite"} className={`ml-auto flex items-center gap-1 px-2 text-xs ${savePresentation.className}`}>{savePresentation.icon}{savePresentation.label}</span>
    {(saveState === "error" || saveState === "offline") && pendingSave.current && <Button type="button" size="xs" variant="ghost" onClick={() => void persistContent(pendingSave.current!)}>{t("editor.save.retry")}</Button>}
  </div>
  <EditorSearchPanel editor={activeEditor} open={searchOpen} onOpenChange={setSearchOpen} />
  {imageUploading && <p className="text-xs text-muted-foreground">{t("uploadingImage")}</p>}
  {imageError && <p className="text-xs text-destructive">{imageError}</p>}
  {saveState === "conflict" && conflictRevision && <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><RotateCcw className="size-4" /><span className="flex-1">{t("editConflictDescription")}</span><Button size="sm" variant="outline" onClick={discardDraftAndReload}>{t("loadCurrent")}</Button><Button size="sm" onClick={() => void restoreConflictDraft()}>{t("restoreMine")}</Button></div>}
  <div className={
    documentMode
      ? commentsVisible
        ? "grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_18rem_18rem]"
        : "grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]"
      : commentsVisible
        ? focused
          ? "grid items-start justify-center gap-8 xl:grid-cols-[minmax(0,56rem)_18rem]"
          : "grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem]"
        : focused ? "w-full" : "block"
  }>
    <div
      ref={editorRootRef}
      className={documentMode ? "wiki-document-workspace relative min-w-0" : "relative min-w-0"}
    >
      <BubbleMenu editor={editor} pluginKey="wikiTextCommentMenu" options={{ strategy: "fixed", flip: true, shift: true, offset: 8 }} shouldShow={({ state }) => !state.selection.empty && !(state.selection instanceof NodeSelection)} className="z-40 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
        <Button type="button" size="sm" variant={activeEditor.isActive("highlight") ? "secondary" : "ghost"} onClick={() => activeEditor.chain().focus().toggleMark("highlight", { createdBy: currentUserId }).run()}><Highlighter className="size-4" />{t("highlightSelection")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={prepareComment}><MessageSquareText className="size-4" />{t("commentSelection")}</Button>
      </BubbleMenu>
      <BubbleMenu editor={editor} pluginKey="wikiImageCommentMenu" options={{ strategy: "fixed", placement: "bottom", flip: true, shift: true, offset: 8 }} shouldShow={({ state }) => state.selection instanceof NodeSelection && ["commentableImage", "pdfEvidence"].includes(state.selection.node.type.name)} className="z-40 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
        <Button type="button" size="sm" variant="ghost" onClick={() => prepareImageComment("whole")}><MessageSquareText className="size-4" />{t("commentWholeImage")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => prepareImageComment("region")}><Scan className="size-4" />{t("selectImageRegion")}</Button>
        {activeEditor.isActive("commentableImage") && documentMode && <>
          <span className="mx-1 h-5 w-px bg-border" />
          {[50, 75, 100].map((width) => <Button key={width} type="button" size="xs" variant="ghost" onClick={() => activeEditor.chain().focus().updateAttributes("commentableImage", { widthPercent: width }).run()}>{width}%</Button>)}
          <Button type="button" size="icon-sm" variant="ghost" aria-label={t("document.image.alignLeft")} onClick={() => activeEditor.chain().focus().updateAttributes("commentableImage", { alignment: "left" }).run()}><AlignLeft /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={t("document.image.alignCenter")} onClick={() => activeEditor.chain().focus().updateAttributes("commentableImage", { alignment: "center" }).run()}><AlignCenter /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={t("document.image.alignRight")} onClick={() => activeEditor.chain().focus().updateAttributes("commentableImage", { alignment: "right" }).run()}><AlignRight /></Button>
        </>}
      </BubbleMenu>
      {documentMode && <BubbleMenu editor={editor} pluginKey="wikiDocumentTableMenu" options={{ strategy: "fixed", placement: "bottom", flip: true, shift: true, offset: 8 }} shouldShow={() => activeEditor.isActive("markdownTable")} className="z-40 flex flex-wrap items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
        <Button type="button" size="sm" variant="ghost" onClick={() => addMarkdownTableRow(activeEditor)}><Rows3 />{t("document.table.addRow")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => addMarkdownTableColumn(activeEditor)}><Columns2 />{t("document.table.addColumn")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => toggleMarkdownTableHeader(activeEditor)}>{t("document.table.header")}</Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("document.image.alignLeft")} onClick={() => setMarkdownTableCellAlignment(activeEditor, "left")}><AlignLeft /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("document.image.alignCenter")} onClick={() => setMarkdownTableCellAlignment(activeEditor, "center")}><AlignCenter /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("document.image.alignRight")} onClick={() => setMarkdownTableCellAlignment(activeEditor, "right")}><AlignRight /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("document.table.deleteRow")} onClick={() => deleteMarkdownTableRow(activeEditor)}><Trash2 /></Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("document.table.deleteColumn")} onClick={() => deleteMarkdownTableColumn(activeEditor)}><Minus /></Button>
      </BubbleMenu>}
      <div className={documentMode ? "wiki-document-canvas" : undefined} style={documentMode ? documentCanvasStyle : undefined}>
        <EditorContent editor={editor} data-testid="wiki-editor" data-document-mode={documentMode ? "true" : "false"} />
      </div>
      <CommentAnchorOverlay visible={commentsVisible} comments={commentThreads} editor={editor} rootRef={editorRootRef} activeThreadId={activeThreadId} onActiveThreadChange={setActiveThreadId} />
    </div>
    <CommentRail ref={commentRailRef} visible={commentsVisible} onVisibleChange={setCommentsVisible} pageId={pageId} comments={commentThreads} currentUserId={currentUserId} editor={editor} editorRootRef={editorRootRef} activeThreadId={activeThreadId} onActiveThreadChange={setActiveThreadId} />
    {documentMode && <DocumentLayoutPanel
      pageId={pageId}
      editor={activeEditor}
      settings={documentSettings}
      onSettingsChange={changeDocumentSettings}
      templates={documentTemplates}
      issues={documentIssues}
      outline={outline}
    />}
  </div>
  {statusVisible && <footer data-testid="editor-writing-status" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-1 pt-2 text-[11px] text-muted-foreground">
    <span>{t("editor.stats.words", { count: writingStats.words })}</span>
    <span>{t("editor.stats.characters", { count: writingStats.characters })}</span>
    {writingStats.selectedWords > 0 && <span>{t("editor.stats.selected", { count: writingStats.selectedWords })}</span>}
    <span>{t("editor.stats.reading", { count: writingStats.readingMinutes })}</span>
    <span className="ml-auto">{t("editor.stats.block", { type: activeEditor.state.selection.$from.parent.type.name })}</span>
  </footer>}
  {regionTarget && <ImageRegionSelector rootRef={editorRootRef} {...regionTarget} onCancel={() => setRegionTarget(null)} onSelect={(anchor) => { setRegionTarget(null); openCommentComposer(anchor); }} />}
  <Dialog open={commentOpen} onOpenChange={(open) => { setCommentOpen(open); if (!open) setPendingAnchor(null); }}><DialogContent className="w-[min(26rem,calc(100vw-2rem))]"><DialogHeader><DialogTitle>{pendingAnchor?.type === "image" ? t("imageComment") : t("inlineComment")}</DialogTitle></DialogHeader>{pendingAnchor?.type !== "page" && pendingAnchor && <blockquote className="border-l-2 border-amber-400 pl-3 text-sm italic text-muted-foreground">{pendingAnchor.type === "text" ? pendingAnchor.quote : pendingAnchor.label}</blockquote>}<Textarea autoFocus value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder={t("commentPlaceholder")} /><Select value={assigneeId} onValueChange={(value) => setAssigneeId(value ?? "none")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("unassigned")}</SelectItem>{users.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select><Button onClick={submitComment} disabled={!commentBody.trim()}>{t("addComment")}</Button></DialogContent></Dialog>
  <MarkdownReferenceDialog open={markdownHelpOpen} onOpenChange={setMarkdownHelpOpen} />
  <EditorOutlineSheet editor={activeEditor} items={outline} activePosition={activeHeadingPosition} open={outlineOpen} onOpenChange={setOutlineOpen} />
  </div>;
}
