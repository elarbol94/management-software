"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Mark, Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Fragment, Slice } from "@tiptap/pm/model";
import { AlertCircle, AlignCenter, AlignLeft, AlignRight, Bold, BookMarked, CalendarClock, Check, ClipboardCheck, CloudOff, Code, Columns2, Eye, EyeOff, FileText, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic, Keyboard, Languages, Link2, List, ListOrdered, ListTree, ListTodo, MessageSquareText, Minus, MoreHorizontal, Paperclip, Pilcrow, Quote, Redo2, RotateCcw, Rows3, Scan, ScissorsLineDashed, Search, Settings2, Strikethrough, Trash2, Underline as UnderlineIcon, Undo2, WifiOff } from "lucide-react";
import { addComment, restorePageRevision } from "../research-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createSlashCommandExtension, type SlashCommandDefinition } from "./slash-command-menu";
import { CommentRail, type CommentRailHandle, type CommentThread } from "./comment-rail";
import { CommentAnchorOverlay } from "./comment-anchor-overlay";
import { CollapsibleHeading, HeadingListItem } from "./collapsible-heading";
import { MarkdownDocumentExtensions, MarkdownShortcutMarks, MarkdownShortcuts } from "./markdown-shortcut-extension";
import { MarkdownReferenceDialog } from "./markdown-reference-dialog";
import { WikiShortcutsDialog } from "./wiki-shortcuts-dialog";
import { EditorLinkPopover, EditorOutlineSheet, EditorSearchPanel, type OutlineItem } from "./editor-tools";
import { mergeCommentThreadIds, normalizeImageRect, type CommentAnchor } from "../lib/comment-anchors";
import { EditorSearchExtension } from "../lib/editor-search";
import { collectSpellcheckParagraphs, createSpellcheckBatches, createSpellcheckExtension, getSpellcheckIssues, mapSpellcheckMatches, remapSpellcheckBatchMatches, replaceAllSpellcheckOccurrences, setSpellcheckIssues, type ProofingLanguage, type SpellcheckIssue, type SpellcheckResponseMatch } from "../lib/spellcheck";
import { looksLikeMarkdown, parseMarkdownDocument } from "../lib/markdown-import";
import { calculateWritingStats, type WritingStats } from "../lib/editor-writing";
import { userMarkColorStyle, type UserMarkColor } from "@/lib/user-mark-colors";
import { DocumentExtensions } from "./document-extension";
import { DocumentLayoutPanel } from "./document-layout-panel";
import { WikiTypographyDialog, type WikiEditorPreferences } from "./wiki-typography-dialog";
import {
  collectDocumentPreflightIssues,
  parseDocumentSettings,
  serializeDocumentSettings,
  type DocumentPreflightIssue,
  type DocumentSettingsV1,
} from "../lib/document-settings";
import {
  normalizeWikiTypography,
  wikiTypographyCssVariables,
  type WikiTypographySettingsV1,
  type WikiTypographyTemplate,
} from "../lib/wiki-typography";
import type { StoredDocumentTemplate } from "../document-queries";
import {
  addMarkdownTableColumn,
  addMarkdownTableRow,
  deleteMarkdownTableColumn,
  deleteMarkdownTableRow,
  setMarkdownTableCellAlignment,
  toggleMarkdownTableHeader,
} from "../lib/document-table";
import {
  DEFAULT_WIKI_SHORTCUT_BINDINGS,
  displayWikiShortcut,
  normalizeWikiShortcut,
  parseWikiShortcutBindings,
  WIKI_SHORTCUT_ACTIONS,
  type WikiShortcutAction,
} from "../lib/wiki-shortcuts";
import { useTaskCreator } from "@/modules/tasks/components/task-create-provider";
import { useDeadlineCreator } from "@/modules/tasks/components/deadline-create-provider";
import { localDateValue } from "@/modules/tasks/deadline-utils";
import type { ContextDeadlineMarker, ContextTaskMarker } from "@/modules/tasks/types";

type PageRef = { id: string; title: string; slug: string };
type SourceRef = { id: string; title: string; issuedDate: string; contributors: string };
type WikiEditorPageActions = { addAttachment: () => void; linkSupportingSource: () => void };
type CachedSpellcheckMatch = Omit<SpellcheckResponseMatch, "paragraph">;
type WikiSaveInput = {
  id: string;
  contentJson: string;
  baseContentJson?: string;
  documentMode?: boolean;
  documentSettingsJson?: string;
  baseDocumentMode?: boolean;
  baseDocumentSettingsJson?: string;
  expectedVersion?: number;
};
type WikiSaveResult =
  | { saved: true; conflict: false; version: number }
  | { saved: false; conflict?: false }
  | { saved: false; conflict: true; version: number; revisionId: string; contentJson: string; documentMode: boolean; documentSettingsJson: string };

async function savePageContentRequest(input: WikiSaveInput): Promise<WikiSaveResult> {
  const response = await fetch(`/api/wiki/pages/${encodeURIComponent(input.id)}/content`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Save failed");
  return response.json() as Promise<WikiSaveResult>;
}

function proofingIssueKey(issue: SpellcheckIssue) {
  return `${issue.ruleId}\u0000${issue.from}\u0000${issue.to}\u0000${issue.message}`;
}

const WIKI_SHORTCUTS_KEY = "wiki:editor-shortcuts:v1";
// These are TipTap's built-in editing combinations. Capture them as well when
// a user has moved the corresponding action, otherwise TipTap would still run
// the old command after the custom shortcut handler intentionally ignores it.
const LEGACY_TIPTAP_SHORTCUTS = new Set([
  "Ctrl+B", "Ctrl+I", "Ctrl+U", "Ctrl+Shift+S", "Ctrl+E",
  "Ctrl+Alt+1", "Ctrl+Alt+2", "Ctrl+Alt+3", "Ctrl+Shift+7", "Ctrl+Shift+8", "Ctrl+Shift+9",
]);
type WikiEditorProps = {
  focused?: boolean;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  pageVersion: number;
  initialContent: string;
  initialProofingLanguage: ProofingLanguage;
  initialDocumentMode: boolean;
  initialDocumentSettings: string;
  documentTemplates: StoredDocumentTemplate[];
  allPages: PageRef[];
  sources: SourceRef[];
  users: Array<{ id: string; name: string; markColor: UserMarkColor }>;
  citationLocale: string;
  comments: CommentThread[];
  currentUserId: string;
  contextTasks: ContextTaskMarker[];
  contextDeadlines: ContextDeadlineMarker[];
  focusTaskId?: string;
  focusDeadlineId?: string;
  pageActions: WikiEditorPageActions;
  initialTypography: WikiTypographySettingsV1;
  editableTypography: WikiTypographySettingsV1;
  typographyTemplates: WikiTypographyTemplate[];
  isPrimaryAuthor: boolean;
};

function loadEditorPreferences(): WikiEditorPreferences {
  if (typeof window === "undefined") return { statusVisible: true, minimalToolbar: false, typewriterMode: false };
  try {
    const stored = JSON.parse(localStorage.getItem("wiki-editor-preferences") ?? "{}") as Partial<WikiEditorPreferences>;
    return { statusVisible: stored.statusVisible ?? true, minimalToolbar: stored.minimalToolbar ?? false, typewriterMode: stored.typewriterMode ?? false };
  } catch {
    return { statusVisible: true, minimalToolbar: false, typewriterMode: false };
  }
}

function loadWikiShortcutBindings() {
  if (typeof window === "undefined") return { ...DEFAULT_WIKI_SHORTCUT_BINDINGS };
  try {
    return parseWikiShortcutBindings(JSON.parse(window.localStorage.getItem(WIKI_SHORTCUTS_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_WIKI_SHORTCUT_BINDINGS };
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

const TaskReference = Node.create({
  name: "taskReference",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      taskId: { default: "" },
      title: { default: "" },
      status: { default: "open" },
      priority: { default: "medium" },
      assigneeName: { default: "" },
    };
  },
  parseHTML() { return [{ tag: "aside[data-task-reference]" }]; },
  renderHTML({ HTMLAttributes }) {
    const done = HTMLAttributes.status === "done";
    return ["aside", mergeAttributes(HTMLAttributes, {
      "data-task-reference": HTMLAttributes.taskId,
      "data-status": HTMLAttributes.status,
      "data-priority": HTMLAttributes.priority,
      class: "wiki-task-reference",
    }),
      ["span", { class: "wiki-task-reference-check" }, done ? "✓" : ""],
      ["span", { class: "wiki-task-reference-body" },
        ["strong", {}, HTMLAttributes.title || "Aufgabe"],
        ["small", {}, [HTMLAttributes.assigneeName, HTMLAttributes.priority].filter(Boolean).join(" · ")],
      ],
    ];
  },
});

const DeadlineReference = Node.create({
  name: "deadlineReference",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      deadlineId: { default: "" },
      title: { default: "" },
      description: { default: "" },
      status: { default: "open" },
      assigneeName: { default: "" },
      deadlineAt: { default: "" },
    };
  },
  parseHTML() { return [{ tag: "aside[data-deadline-reference]" }]; },
  renderHTML({ HTMLAttributes }) {
    const done = HTMLAttributes.status === "done";
    return ["aside", mergeAttributes(HTMLAttributes, {
      "data-deadline-reference": HTMLAttributes.deadlineId,
      "data-status": HTMLAttributes.status,
      class: "wiki-deadline-reference",
    }),
      ["span", { class: "wiki-deadline-reference-icon" }, done ? "✓" : "◷"],
      ["span", { class: "wiki-deadline-reference-body" },
        ["strong", {}, HTMLAttributes.title || "Deadline"],
        ["small", {}, [HTMLAttributes.deadlineAt, HTMLAttributes.assigneeName].filter(Boolean).join(" · ")],
      ],
    ];
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

function ToolbarMenu({ label, icon, children, onPointerDown }: { label: string; icon: React.ReactNode; children: React.ReactNode; onPointerDown?: () => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" className="gap-1 px-2" aria-label={label} onFocus={onPointerDown} onPointerDown={onPointerDown} />}>{icon}<span className="hidden text-xs sm:inline">{label}</span></DropdownMenuTrigger>
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
  pageTitle,
  pageSlug,
  pageVersion,
  initialContent,
  initialProofingLanguage,
  initialDocumentMode,
  initialDocumentSettings,
  documentTemplates,
  allPages,
  sources,
  users,
  citationLocale,
  comments,
  contextTasks,
  contextDeadlines,
  focusTaskId,
  focusDeadlineId,
  currentUserId,
  pageActions,
  initialTypography,
  editableTypography,
  typographyTemplates,
  isPrimaryAuthor,
}: WikiEditorProps) {
  const t = useTranslations("wiki"); const tTasks = useTranslations("tasks"); const tDeadlines = useTranslations("deadlines"); const format = useFormatter(); const router = useRouter(); const { openTaskCreator } = useTaskCreator(); const { openDeadlineCreator } = useDeadlineCreator(); const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved" | "offline" | "error" | "conflict">("idle");
  const [conflictRevision, setConflictRevision] = useState<string | null>(null); const [activeThreadId, setActiveThreadId] = useState<string | null>(null); const [optimisticCommentThreads, setOptimisticCommentThreads] = useState<CommentThread[]>([]); const [commentFocusRequest, setCommentFocusRequest] = useState(0); const [imagePickerRequest, setImagePickerRequest] = useState(0); const [commentOpen, setCommentOpen] = useState(false); const [commentBody, setCommentBody] = useState(""); const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null); const [regionTarget, setRegionTarget] = useState<{ nodeId: string; label: string } | null>(null); const [imageError, setImageError] = useState(""); const [imageUploading, setImageUploading] = useState(false); const [assigneeId, setAssigneeId] = useState("none");
  const commentThreads = useMemo(
    () => [...optimisticCommentThreads.filter((thread) => !comments.some((item) => item.id === thread.id)), ...comments],
    [comments, optimisticCommentThreads],
  );
  const [pageLinkOpen, setPageLinkOpen] = useState(false); const [citationOpen, setCitationOpen] = useState(false); const [evidenceOpen, setEvidenceOpen] = useState(false); const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false); const [shortcutsOpen, setShortcutsOpen] = useState(false); const [linkEditorRequest, setLinkEditorRequest] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false); const [outlineOpen, setOutlineOpen] = useState(false); const [outline, setOutline] = useState<OutlineItem[]>([]); const [activeHeadingPosition, setActiveHeadingPosition] = useState<number | null>(null);
  const [writingStats, setWritingStats] = useState<WritingStats>({ words: 0, characters: 0, selectedWords: 0, readingMinutes: 0 });
  const [documentMode, setDocumentMode] = useState(initialDocumentMode);
  const [documentSettings, setDocumentSettings] = useState<DocumentSettingsV1>(() => parseDocumentSettings(initialDocumentSettings));
  const [documentIssues, setDocumentIssues] = useState<DocumentPreflightIssue[]>([]);
  const [typography, setTypography] = useState(() => normalizeWikiTypography(initialTypography));
  const [personalTypography, setPersonalTypography] = useState(() => normalizeWikiTypography(editableTypography));
  const [personalTypographyTemplates, setPersonalTypographyTemplates] = useState(typographyTemplates);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [spellcheckIssue, setSpellcheckIssue] = useState<{ issue: SpellcheckIssue; rect: DOMRect } | null>(null);
  const [proofingLanguage, setProofingLanguage] = useState<ProofingLanguage>(initialProofingLanguage);
  const [proofingStatus, setProofingStatus] = useState<"ready" | "checking" | "error">("checking");
  const [proofingSaving, setProofingSaving] = useState(false);
  const proofingCache = useRef(new Map<string, CachedSpellcheckMatch[]>());
  const [proofingDictionary, setProofingDictionary] = useState<string[]>([]);
  const [proofingDictionaryLoaded, setProofingDictionaryLoaded] = useState(false);
  const ignoredProofingIssues = useRef(new Set<string>());
  const preserveProofingOnNextUpdate = useRef(false);
  const [wikiShortcuts, setWikiShortcuts] = useState(loadWikiShortcutBindings);
  const [initialPreferences] = useState(loadEditorPreferences);
  const [statusVisible, setStatusVisible] = useState(initialPreferences.statusVisible); const [minimalToolbar, setMinimalToolbar] = useState(initialPreferences.minimalToolbar); const [typewriterMode, setTypewriterMode] = useState(initialPreferences.typewriterMode); const typewriterModeRef = useRef(initialPreferences.typewriterMode);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const version = useRef(pageVersion); const lastServerContent = useRef(initialContent); const lastServerDocumentMode = useRef(initialDocumentMode); const lastServerDocumentSettings = useRef(serializeDocumentSettings(parseDocumentSettings(initialDocumentSettings))); const documentModeRef = useRef(initialDocumentMode); const documentSettingsRef = useRef(parseDocumentSettings(initialDocumentSettings)); const pendingSave = useRef<string | null>(null); const persistContentRef = useRef<(json: string) => Promise<void>>(async () => {}); const conflictBlocked = useRef(false); const selection = useRef<{ from: number; to: number } | null>(null); const toolbarSelection = useRef<{ from: number; to: number } | null>(null); const imageInputRef = useRef<HTMLInputElement>(null); const editorRootRef = useRef<HTMLDivElement>(null); const commentRailRef = useRef<CommentRailHandle>(null); const [commentsVisible, setCommentsVisible] = useState(!focused); const previousFocused = useRef(focused); const storageKey = `wiki-draft:${pageId}`; const preferencesKey = `wiki-editor-preferences`;
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
      let result = await savePageContentRequest({
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
        result = await savePageContentRequest({
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

  function requestWikiTask(targetEditor: Editor) {
    const { from, to } = targetEditor.state.selection;
    const quote = targetEditor.state.doc.textBetween(from, to, " ").trim();
    openTaskCreator({
      initialTitle: quote,
      origin: {
        type: "wikiPage",
        entityId: pageId,
        route: `/wiki/pages/${encodeURIComponent(pageSlug)}`,
        label: pageTitle,
        anchor: { quote, from, to },
      },
      onCreated: (taskId) => {
        targetEditor.chain().focus().insertContent({
          type: "taskReference",
          attrs: {
            taskId,
            title: quote || tTasks("title"),
            status: "open",
            priority: "medium",
            assigneeName: "",
          },
        }).run();
        router.refresh();
      },
    });
  }

  function requestWikiDeadline(targetEditor: Editor) {
    const { from, to } = targetEditor.state.selection;
    const quote = targetEditor.state.doc.textBetween(from, to, " ").trim();
    openDeadlineCreator({
      initialTitle: quote,
      origin: {
        type: "wikiPage",
        entityId: pageId,
        route: `/wiki/pages/${encodeURIComponent(pageSlug)}`,
        label: pageTitle,
        anchor: { quote, from, to },
      },
      onCreated: (deadlineId) => {
        targetEditor.chain().focus().insertContent({
          type: "deadlineReference",
          attrs: {
            deadlineId,
            title: quote || tDeadlines("title"),
            status: "open",
            assigneeName: "",
            deadlineAt: "",
          },
        }).run();
        router.refresh();
      },
    });
  }

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
    slash("todo", "wiki", ClipboardCheck, (editor) => requestWikiTask(editor)),
    slash("deadline", "wiki", CalendarClock, (editor) => requestWikiDeadline(editor)),
    slash("externalLink", "wiki", Link2, () => setLinkEditorRequest((value) => value + 1)),
    slash("citation", "wiki", BookMarked, () => setCitationOpen(true)),
    slash("pdfEvidence", "wiki", Highlighter, () => setEvidenceOpen(true)),
    slash("inlineImage", "wiki", ImagePlus, () => setImagePickerRequest((value) => value + 1)),
    slash("attachment", "wiki", Paperclip, () => pageActions.addAttachment()),
    slash("supportingSource", "wiki", BookMarked, () => pageActions.linkSupportingSource()),
    slash("pageComment", "wiki", MessageSquareText, () => setCommentFocusRequest((value) => value + 1)),
  ];
  const slashExtension = createSlashCommandExtension({ commands: slashCommands, ariaLabel: t("slash.ariaLabel"), emptyLabel: t("slash.empty") });

  const editor = useEditor({ immediatelyRender: false, enableInputRules: ["blockquote", "bulletList", "codeBlock", "heading", "orderedList", "taskItem"], extensions: [StarterKit.configure({ bold: false, code: false, heading: false, listItem: false, italic: false, link: { openOnClick: false }, strike: false }), CollapsibleHeading.configure({ levels: [1, 2, 3] }), HeadingListItem, ...MarkdownShortcutMarks, ...MarkdownDocumentExtensions, ...DocumentExtensions, TaskList, TaskItem.configure({ nested: true }), Citation, PdfEvidence, TaskReference, DeadlineReference, CommentableImage, CommentMark, Highlight, Placeholder.configure({ placeholder: ({ node }) => node.type.name === "heading" ? t("editor.placeholder.heading") : t("editor.placeholder.empty") }), EditorSearchExtension, createSpellcheckExtension((issue, target) => setSpellcheckIssue({ issue, rect: target.getBoundingClientRect() })), MarkdownShortcuts, slashExtension], content,
    editorProps: {
      attributes: { class: "prose prose-neutral dark:prose-invert max-w-none min-h-[28rem] focus:outline-none", spellcheck: "false" },
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
    const controller = new AbortController();
    void fetch(`/api/wiki/proofing-dictionary?language=${encodeURIComponent(proofingLanguage)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Dictionary unavailable");
        return response.json() as Promise<{ words: string[] }>;
      })
      .then(({ words }) => {
        proofingCache.current.clear();
        setProofingDictionary(words);
        setProofingDictionaryLoaded(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        proofingCache.current.clear();
        setProofingDictionary([]);
        setProofingDictionaryLoaded(true);
      });
    return () => controller.abort();
  }, [proofingLanguage]);

  useEffect(() => {
    if (!editor || !proofingDictionaryLoaded) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let generation = 0;

    const requestProofing = async (paragraphs: ReturnType<typeof collectSpellcheckParagraphs>, activeController: AbortController) => {
      const matches: SpellcheckResponseMatch[] = [];
      for (const batch of createSpellcheckBatches(paragraphs)) {
        const uncachedItems = batch.items.filter((item) => {
          const cached = proofingCache.current.get(`${proofingLanguage}\u0000${item.text}`);
          if (!cached) return true;
          matches.push(...cached.map((match) => ({ ...match, paragraph: item.paragraph, offset: item.offset + match.offset })));
          return false;
        });
        if (!uncachedItems.length) continue;
        const requestBatch = { items: uncachedItems };
        const response = await fetch("/api/wiki/spellcheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paragraphs: requestBatch.items.map((item) => item.text),
            language: proofingLanguage,
            dictionary: proofingDictionary,
          }),
          signal: activeController.signal,
        });
        if (!response.ok) throw new Error("Spellcheck unavailable");
        const payload = await response.json() as { matches: SpellcheckResponseMatch[] };
        for (const [paragraph, item] of requestBatch.items.entries()) {
          const itemMatches = payload.matches
            .filter((match) => match.paragraph === paragraph)
            .map((match): CachedSpellcheckMatch => ({
              offset: match.offset,
              length: match.length,
              message: match.message,
              kind: match.kind,
              category: match.category,
              ruleId: match.ruleId,
              replacements: match.replacements,
            }));
          proofingCache.current.set(`${proofingLanguage}\u0000${item.text}`, itemMatches);
          if (proofingCache.current.size > 500) {
            const oldestKey = proofingCache.current.keys().next().value;
            if (typeof oldestKey === "string") proofingCache.current.delete(oldestKey);
          }
        }
        matches.push(...remapSpellcheckBatchMatches(requestBatch, payload.matches));
      }
      return mapSpellcheckMatches(paragraphs, matches).filter((issue) => !ignoredProofingIssues.current.has(proofingIssueKey(issue)));
    };

    const check = async (checkGeneration: number) => {
      const paragraphs = collectSpellcheckParagraphs(editor.state.doc);
      setSpellcheckIssue(null);
      if (!paragraphs.length) {
        setSpellcheckIssues(editor, []);
        setProofingStatus("ready");
        return;
      }

      const activeController = new AbortController();
      controller = activeController;
      setProofingStatus("checking");
      try {
        const cursor = editor.state.selection.from;
        const priorityIndex = paragraphs.findIndex((paragraph) => paragraph.from <= cursor && cursor <= paragraph.from + paragraph.text.length);
        const priorityParagraphs = [paragraphs[priorityIndex >= 0 ? priorityIndex : 0]];
        const priorityIssues = await requestProofing(priorityParagraphs, activeController);
        if (checkGeneration !== generation || activeController.signal.aborted) return;
        setSpellcheckIssues(editor, priorityIssues);

        const fullIssues = paragraphs.length === 1 ? priorityIssues : await requestProofing(paragraphs, activeController);
        if (checkGeneration !== generation || activeController.signal.aborted) return;
        setSpellcheckIssues(editor, fullIssues);
        setProofingStatus("ready");
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (checkGeneration !== generation) return;
        setSpellcheckIssues(editor, []);
        setProofingStatus("error");
      }
    };

    const schedule = () => {
      if (preserveProofingOnNextUpdate.current) {
        preserveProofingOnNextUpdate.current = false;
        return;
      }
      if (timer) clearTimeout(timer);
      controller?.abort();
      generation += 1;
      setSpellcheckIssue(null);
      setSpellcheckIssues(editor, []);
      timer = setTimeout(() => void check(generation), 420);
    };
    editor.on("update", schedule);
    void check(++generation);
    return () => {
      generation += 1;
      if (timer) clearTimeout(timer);
      controller?.abort();
      editor.off("update", schedule);
    };
  }, [editor, pageId, proofingDictionary, proofingDictionaryLoaded, proofingLanguage]);
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
  useEffect(() => { window.localStorage.setItem(WIKI_SHORTCUTS_KEY, JSON.stringify(wikiShortcuts)); }, [wikiShortcuts]);
  useEffect(() => {
    const online = () => { if (pendingSave.current) void persistContentRef.current(pendingSave.current); };
    const offline = () => { if (pendingSave.current) setSaveState("offline"); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);
  const handleWikiShortcut = useEffectEvent((event: KeyboardEvent) => {
      if (!editor || event.defaultPrevented || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      const activeElement = document.activeElement as HTMLElement | null;
      if (!editorRootRef.current?.contains(target) && !editorRootRef.current?.contains(activeElement)) return;
      if (target?.closest("input, textarea, select, [role=dialog], [role=menu], [data-shortcut-recorder]")) return;
      const binding = normalizeWikiShortcut(event);
      if (!binding) return;
      const action = WIKI_SHORTCUT_ACTIONS.find((candidate) => wikiShortcuts[candidate] === binding);
      if (!action && !LEGACY_TIPTAP_SHORTCUTS.has(binding)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!action) return;
      const run = (command: () => boolean) => command();
      switch (action) {
        case "undo": run(() => editor.chain().focus().undo().run()); break;
        case "redo": run(() => editor.chain().focus().redo().run()); break;
        case "bold": run(() => editor.chain().focus().toggleBold().run()); break;
        case "italic": run(() => editor.chain().focus().toggleItalic().run()); break;
        case "underline": run(() => editor.chain().focus().toggleUnderline().run()); break;
        case "highlight": run(() => editor.chain().focus().toggleMark("highlight", { createdBy: currentUserId }).run()); break;
        case "strike": run(() => editor.chain().focus().toggleStrike().run()); break;
        case "inlineCode": run(() => editor.chain().focus().toggleCode().run()); break;
        case "heading1": run(() => editor.chain().focus().toggleHeading({ level: 1 }).run()); break;
        case "heading2": run(() => editor.chain().focus().toggleHeading({ level: 2 }).run()); break;
        case "heading3": run(() => editor.chain().focus().toggleHeading({ level: 3 }).run()); break;
        case "bulletList": run(() => editor.chain().focus().toggleBulletList().run()); break;
        case "orderedList": run(() => editor.chain().focus().toggleOrderedList().run()); break;
        case "taskList": run(() => editor.chain().focus().toggleTaskList().run()); break;
        case "blockquote": run(() => editor.chain().focus().toggleBlockquote().run()); break;
        case "codeBlock": run(() => editor.chain().focus().toggleCodeBlock().run()); break;
        case "horizontalRule": run(() => editor.chain().focus().setHorizontalRule().run()); break;
        case "pageBreak": run(() => editor.chain().focus().insertContent({ type: "pageBreak" }).run()); break;
        case "tableOfContents": run(() => editor.chain().focus().insertContent({ type: "tableOfContents", attrs: { title: t("document.contents"), maxLevel: 3 } }).run()); break;
        case "twoColumns": run(() => editor.chain().focus().insertContent({ type: "layoutSection", attrs: { columns: 2, gapMm: 8 }, content: [{ type: "paragraph" }, { type: "paragraph" }] }).run()); break;
        case "search": setSearchOpen(true); break;
        case "outline": setOutlineOpen(true); break;
        case "inlineComment": prepareComment(); break;
        case "toggleComments": setCommentsVisible((value) => !value); break;
        case "documentMode": changeDocumentMode(!documentMode); break;
        case "markdownHelp": setMarkdownHelpOpen(true); break;
        case "typography": setTypographyOpen(true); break;
        case "shortcuts": setShortcutsOpen(true); break;
        case "image": imageInputRef.current?.click(); break;
        case "pageLink": setPageLinkOpen(true); break;
        case "externalLink": setLinkEditorRequest((value) => value + 1); break;
        case "citation": setCitationOpen(true); break;
        case "pdfEvidence": setEvidenceOpen(true); break;
        case "attachment": pageActions.addAttachment(); break;
        case "supportingSource": pageActions.linkSupportingSource(); break;
        case "imageHighlight": run(() => editor.chain().focus().toggleMark("highlight", { createdBy: currentUserId }).run()); break;
        case "imageComment": prepareImageComment("whole"); break;
        case "imageRegion": prepareImageComment("region"); break;
        case "imageWidth50": run(() => editor.chain().focus().updateAttributes("commentableImage", { widthPercent: 50 }).run()); break;
        case "imageWidth75": run(() => editor.chain().focus().updateAttributes("commentableImage", { widthPercent: 75 }).run()); break;
        case "imageWidth100": run(() => editor.chain().focus().updateAttributes("commentableImage", { widthPercent: 100 }).run()); break;
        case "imageAlignLeft": run(() => editor.chain().focus().updateAttributes("commentableImage", { alignment: "left" }).run()); break;
        case "imageAlignCenter": run(() => editor.chain().focus().updateAttributes("commentableImage", { alignment: "center" }).run()); break;
        case "imageAlignRight": run(() => editor.chain().focus().updateAttributes("commentableImage", { alignment: "right" }).run()); break;
        case "tableAddRow": addMarkdownTableRow(editor); break;
        case "tableAddColumn": addMarkdownTableColumn(editor); break;
        case "tableHeader": toggleMarkdownTableHeader(editor); break;
        case "tableAlignLeft": setMarkdownTableCellAlignment(editor, "left"); break;
        case "tableAlignCenter": setMarkdownTableCellAlignment(editor, "center"); break;
        case "tableAlignRight": setMarkdownTableCellAlignment(editor, "right"); break;
        case "tableDeleteRow": deleteMarkdownTableRow(editor); break;
        case "tableDeleteColumn": deleteMarkdownTableColumn(editor); break;
      }
  });

  useEffect(() => {
    if (!editor) return;
    const byId = new Map(contextTasks.map((task) => [task.id, task]));
    const transaction = editor.state.tr;
    let changed = false;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "taskReference") return;
      const task = byId.get(String(node.attrs.taskId));
      if (!task) return;
      const nextAttrs = {
        ...node.attrs,
        title: task.title,
        status: task.status,
        priority: task.priority,
        assigneeName: task.assigneeName ?? "",
      };
      if (JSON.stringify(nextAttrs) !== JSON.stringify(node.attrs)) {
        transaction.setNodeMarkup(position, undefined, nextAttrs);
        changed = true;
      }
    });
    if (changed) editor.view.dispatch(transaction);
  }, [contextTasks, editor]);

  useEffect(() => {
    if (!editor) return;
    const byId = new Map(contextDeadlines.map((deadline) => [deadline.id, deadline]));
    const transaction = editor.state.tr;
    let changed = false;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "deadlineReference") return;
      const deadline = byId.get(String(node.attrs.deadlineId));
      if (!deadline) return;
      const localDate = localDateValue(deadline.deadlineDate);
      const dateLabel = localDate
        ? format.dateTime(localDate, { dateStyle: "medium" })
        : deadline.deadlineDate;
      const timeLabel = deadline.deadlineAt
        ? format.dateTime(new Date(deadline.deadlineAt), { timeStyle: "short" })
        : "";
      const nextAttrs = {
        ...node.attrs,
        title: deadline.title,
        description: deadline.description,
        status: deadline.status,
        assigneeName: deadline.assigneeName ?? "",
        deadlineAt: [dateLabel, timeLabel].filter(Boolean).join(", "),
      };
      if (JSON.stringify(nextAttrs) !== JSON.stringify(node.attrs)) {
        transaction.setNodeMarkup(position, undefined, nextAttrs);
        changed = true;
      }
    });
    if (changed) editor.view.dispatch(transaction);
  }, [contextDeadlines, editor, format]);

  useEffect(() => {
    if (!editor || !focusTaskId) return;
    const timeout = window.setTimeout(() => {
      const marker = editorRootRef.current?.querySelector<HTMLElement>(
        `[data-task-reference="${CSS.escape(focusTaskId)}"]`,
      );
      if (marker) {
        marker.scrollIntoView({ behavior: "smooth", block: "center" });
        marker.focus({ preventScroll: true });
      } else {
        toast.info(tTasks("sourceFallback"));
      }
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [editor, focusTaskId, tTasks]);

  useEffect(() => {
    if (!editor || !focusDeadlineId) return;
    const timeout = window.setTimeout(() => {
      const marker = editorRootRef.current?.querySelector<HTMLElement>(
        `[data-deadline-reference="${CSS.escape(focusDeadlineId)}"]`,
      );
      if (marker) {
        marker.scrollIntoView({ behavior: "smooth", block: "center" });
        marker.focus({ preventScroll: true });
      } else {
        toast.info(tDeadlines("sourceFallback"));
      }
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [editor, focusDeadlineId, tDeadlines]);
  useEffect(() => {
    if (!editor) return;
    const shortcut = (event: KeyboardEvent) => handleWikiShortcut(event);
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [editor]);
  if (!editor) return <div className="min-h-[28rem]" />;
  const activeEditor = editor;
  function rememberToolbarSelection() {
    const { from, to } = activeEditor.state.selection;
    toolbarSelection.current = { from, to };
  }
  function toolbarChain() {
    const saved = toolbarSelection.current;
    const chain = activeEditor.chain();
    if (saved) {
      const end = activeEditor.state.doc.content.size;
      chain.setTextSelection({
        from: Math.min(saved.from, end),
        to: Math.min(saved.to, end),
      });
    }
    return chain.focus();
  }
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
    ...wikiTypographyCssVariables(typography),
    "--document-paper-width": `${documentSettings.page.orientation === "portrait" ? paperWidth : paperHeight}mm`,
    "--document-paper-height": `${documentSettings.page.orientation === "portrait" ? paperHeight : paperWidth}mm`,
    "--document-margin-top": `${documentSettings.page.marginsMm.top}mm`,
    "--document-margin-right": `${documentSettings.page.marginsMm.right}mm`,
    "--document-margin-bottom": `${documentSettings.page.marginsMm.bottom}mm`,
    "--document-margin-left": `${documentSettings.page.marginsMm.left}mm`,
  } as CSSProperties;
  const editorTypographyStyle = wikiTypographyCssVariables(typography) as CSSProperties;
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

  async function toggleProofingLanguage() {
    const previous = proofingLanguage;
    const next: ProofingLanguage = previous === "de-DE" ? "en-US" : "de-DE";
    setProofingSaving(true);
    setProofingDictionaryLoaded(false);
    setProofingDictionary([]);
    proofingCache.current.clear();
    setProofingLanguage(next);
    setSpellcheckIssue(null);
    try {
      const response = await fetch("/api/wiki/pages/" + encodeURIComponent(pageId) + "/proofing-language", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: next }),
      });
      if (!response.ok) throw new Error("Proofing language save failed");
    } catch {
      setProofingLanguage(previous);
      toast.error(t("editor.proofing.saveFailed"));
    } finally {
      setProofingSaving(false);
    }
  }

  function ignoreCurrentProofingIssue() {
    if (!spellcheckIssue) return;
    ignoredProofingIssues.current.add(proofingIssueKey(spellcheckIssue.issue));
    setSpellcheckIssues(activeEditor, getSpellcheckIssues(activeEditor).filter((issue) => proofingIssueKey(issue) !== proofingIssueKey(spellcheckIssue.issue)));
    setSpellcheckIssue(null);
  }

  async function addCurrentWordToDictionary() {
    if (!spellcheckIssue || spellcheckIssue.issue.kind !== "spelling") return;
    const word = activeEditor.state.doc.textBetween(spellcheckIssue.issue.from, spellcheckIssue.issue.to).trim();
    if (!word) return;
    try {
      const response = await fetch("/api/wiki/proofing-dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: proofingLanguage, word }),
      });
      if (!response.ok) throw new Error("Dictionary save failed");
      const payload = await response.json() as { word: string };
      proofingCache.current.clear();
      setProofingDictionary((current) => current.some((item) => item.toLocaleLowerCase(proofingLanguage) === payload.word.toLocaleLowerCase(proofingLanguage)) ? current : [...current, payload.word]);
      setSpellcheckIssue(null);
      toast.success(t("editor.proofing.dictionaryAdded", { word: payload.word }));
    } catch {
      toast.error(t("editor.proofing.dictionaryFailed"));
    }
  }

  function replaceAllCurrentProofingIssue(replacement: string) {
    if (!spellcheckIssue) return;
    const source = activeEditor.state.doc.textBetween(spellcheckIssue.issue.from, spellcheckIssue.issue.to);
    if (!source || source === replacement) return;
    preserveProofingOnNextUpdate.current = true;
    const count = replaceAllSpellcheckOccurrences(activeEditor, source, replacement);
    if (!count) preserveProofingOnNextUpdate.current = false;
    setSpellcheckIssue(null);
    if (count > 0) toast.success(t("editor.proofing.replacedAll", { count }));
  }

  function replaceCurrentProofingIssue(replacement: string) {
    if (!spellcheckIssue) return;
    const { issue } = spellcheckIssue;
    const source = activeEditor.state.doc.textBetween(issue.from, issue.to);
    if (!source || source === replacement) return;
    preserveProofingOnNextUpdate.current = true;
    activeEditor.chain().focus().insertContentAt({ from: issue.from, to: issue.to }, replacement).run();
    setSpellcheckIssue(null);
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
  const shortcutLabel = (action: WikiShortcutAction) => displayWikiShortcut(wikiShortcuts[action]);
  const proofingLanguageLabel = proofingLanguage === "de-DE" ? t("editor.proofing.languages.de") : t("editor.proofing.languages.en");
  const nextProofingLanguageLabel = proofingLanguage === "de-DE" ? t("editor.proofing.languages.en") : t("editor.proofing.languages.de");
  const proofingButtonTitle = proofingStatus === "error"
    ? t("editor.proofing.unavailable")
    : t("editor.proofing.switch", { language: proofingLanguageLabel, nextLanguage: nextProofingLanguageLabel });

  return <div className="relative flex flex-col gap-3"><div className="sticky top-0 z-40 flex flex-wrap items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
    <ToolbarButton title={t("editor.toolbar.undo")} shortcut={shortcutLabel("undo")} onClick={() => activeEditor.chain().focus().undo().run()}><Undo2 className="size-4" /></ToolbarButton>
    <ToolbarButton title={t("editor.toolbar.redo")} shortcut={shortcutLabel("redo")} onClick={() => activeEditor.chain().focus().redo().run()}><Redo2 className="size-4" /></ToolbarButton>
    <span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton title={t("editor.toolbar.bold")} shortcut={shortcutLabel("bold")} active={activeEditor.isActive("bold")} onClick={() => activeEditor.chain().focus().toggleBold().run()}><Bold className="size-4" /></ToolbarButton>
    <ToolbarButton title={t("editor.toolbar.italic")} shortcut={shortcutLabel("italic")} active={activeEditor.isActive("italic")} onClick={() => activeEditor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></ToolbarButton>
    {!minimalToolbar && <>
      <ToolbarButton title={t("editor.toolbar.heading1")} shortcut={shortcutLabel("heading1")} active={activeEditor.isActive("heading", { level: 1 })} onClick={() => activeEditor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="size-4" /></ToolbarButton>
      <ToolbarButton title={t("editor.toolbar.heading2")} shortcut={shortcutLabel("heading2")} active={activeEditor.isActive("heading", { level: 2 })} onClick={() => activeEditor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="size-4" /></ToolbarButton>
      <ToolbarButton title={t("editor.toolbar.bulletList")} shortcut={shortcutLabel("bulletList")} active={activeEditor.isActive("bulletList")} onClick={() => activeEditor.chain().focus().toggleBulletList().run()}><List className="size-4" /></ToolbarButton>
      <ToolbarButton title={t("editor.toolbar.orderedList")} shortcut={shortcutLabel("orderedList")} active={activeEditor.isActive("orderedList")} onClick={() => activeEditor.chain().focus().toggleOrderedList().run()}><ListOrdered className="size-4" /></ToolbarButton>
    </>}
    <ToolbarMenu label={t("editor.toolbar.format")} icon={<MoreHorizontal className="size-4" />} onPointerDown={rememberToolbarSelection}>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("editor.toolbar.format")}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => toolbarChain().toggleHeading({ level: 3 }).run()}><Heading3 />{t("editor.toolbar.heading3")}<DropdownMenuShortcut>{shortcutLabel("heading3")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => toolbarChain().toggleUnderline().run()}><UnderlineIcon />{t("editor.toolbar.underline")}<DropdownMenuShortcut>{shortcutLabel("underline")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => toolbarChain().toggleMark("highlight", { createdBy: currentUserId }).run()}><Highlighter />{t("editor.toolbar.highlight")}<DropdownMenuShortcut>{shortcutLabel("highlight")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => toolbarChain().toggleStrike().run()}><Strikethrough />{t("editor.toolbar.strike")}<DropdownMenuShortcut>{shortcutLabel("strike")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => toolbarChain().toggleCode().run()}><Code />{t("editor.toolbar.inlineCode")}<DropdownMenuShortcut>{shortcutLabel("inlineCode")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => toolbarChain().toggleTaskList().run()}><ListTodo />{t("editor.toolbar.taskList")}<DropdownMenuShortcut>{shortcutLabel("taskList")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => toolbarChain().toggleBlockquote().run()}><Quote />{t("editor.toolbar.blockquote")}<DropdownMenuShortcut>{shortcutLabel("blockquote")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => toolbarChain().toggleCodeBlock().run()}><Code />{t("editor.toolbar.codeBlock")}<DropdownMenuShortcut>{shortcutLabel("codeBlock")}</DropdownMenuShortcut></DropdownMenuItem>
      </DropdownMenuGroup>
    </ToolbarMenu>
    <EditorLinkPopover editor={activeEditor} pages={allPages} request={linkEditorRequest} />
    <PageLinkPicker editor={editor} pages={allPages} open={pageLinkOpen} onOpenChange={setPageLinkOpen} /><CitationPicker editor={editor} sources={sources} locale={citationLocale} open={citationOpen} onOpenChange={setCitationOpen} /><EvidencePicker editor={editor} pageId={pageId} locale={citationLocale} open={evidenceOpen} onOpenChange={setEvidenceOpen} />
    <ToolbarMenu label={t("editor.toolbar.insert")} icon={<ImagePlus className="size-4" />} onPointerDown={rememberToolbarSelection}>
      <DropdownMenuItem onClick={() => imageInputRef.current?.click()}><ImagePlus />{t("insertImage")}<DropdownMenuShortcut>{shortcutLabel("image")}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onClick={() => toolbarChain().setHorizontalRule().run()}><Minus />{t("slash.commands.horizontalRule.label")}<DropdownMenuShortcut>{shortcutLabel("horizontalRule")}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onClick={() => pageActions.addAttachment()}><Paperclip />{t("slash.commands.attachment.label")}<DropdownMenuShortcut>{shortcutLabel("attachment")}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onClick={() => pageActions.linkSupportingSource()}><BookMarked />{t("slash.commands.supportingSource.label")}<DropdownMenuShortcut>{shortcutLabel("supportingSource")}</DropdownMenuShortcut></DropdownMenuItem>
    </ToolbarMenu>
    <input ref={imageInputRef} data-testid="wiki-inline-image-input" hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertInlineImage(file); event.target.value = ""; }} />
    <Tooltip>
      <TooltipTrigger render={<Button type="button" data-testid="proofing-language-toggle" size="sm" variant="ghost" className="gap-1 px-2 text-xs" aria-label={proofingButtonTitle} aria-busy={proofingStatus === "checking" || proofingSaving} disabled={proofingSaving} onClick={() => void toggleProofingLanguage()} />}>
        {proofingStatus === "checking" || proofingSaving ? <RotateCcw className="size-3.5 animate-spin" /> : proofingStatus === "error" ? <AlertCircle className="size-3.5 text-destructive" /> : <Languages className="size-3.5" />}
        <span>{proofingLanguage === "de-DE" ? "DE" : "EN"}</span>
      </TooltipTrigger>
      <TooltipContent>{proofingButtonTitle}{proofingStatus === "checking" && <span> · {t("editor.proofing.checking")}</span>}</TooltipContent>
    </Tooltip>
    <span className="mx-1 h-5 w-px bg-border" />
    <ToolbarButton title={t("editor.search.title")} shortcut={shortcutLabel("search")} active={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search className="size-4" /></ToolbarButton>
    <ToolbarButton title={t("editor.outline.title")} shortcut={shortcutLabel("outline")} active={outlineOpen} onClick={() => setOutlineOpen(true)}><ListTree className="size-4" /></ToolbarButton>
    <ToolbarButton title={t("inlineComment")} shortcut={shortcutLabel("inlineComment")} onClick={prepareComment}><MessageSquareText className="size-4" /></ToolbarButton>
    <ToolbarButton title={tTasks("createTask")} shortcut={tTasks("globalShortcut")} onClick={() => requestWikiTask(activeEditor)}><ClipboardCheck className="size-4" /></ToolbarButton>
    <ToolbarButton title={tDeadlines("createDeadline")} shortcut={tDeadlines("globalShortcut")} onClick={() => requestWikiDeadline(activeEditor)}><CalendarClock className="size-4" /></ToolbarButton>
    <ToolbarButton title={commentsVisible ? t("hideComments") : t("showComments")} shortcut={shortcutLabel("toggleComments")} active={commentsVisible} onClick={() => setCommentsVisible((value) => !value)}>{commentsVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</ToolbarButton>
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
    <Button type="button" data-testid="markdown-help-button" size="sm" variant="ghost" className="gap-1.5 px-2 text-xs" title={shortcutLabel("markdownHelp")} onClick={() => setMarkdownHelpOpen(true)}><BookMarked className="size-3.5" />{t("markdownHelp.button")}</Button>
    <ToolbarButton title={t("editor.preferences.title")} shortcut={shortcutLabel("typography")} active={typographyOpen} onClick={() => setTypographyOpen(true)}>
      <Settings2 className="size-4" />
    </ToolbarButton>
    <ToolbarButton title={t("shortcuts.title")} shortcut={shortcutLabel("shortcuts")} active={shortcutsOpen} onClick={() => setShortcutsOpen(true)}><Keyboard className="size-4" /></ToolbarButton>
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
      onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLocaleLowerCase() === "a") {
          event.preventDefault();
          event.stopPropagation();
          requestWikiTask(activeEditor);
        }
      }}
    >
      <BubbleMenu editor={editor} pluginKey="wikiTextCommentMenu" options={{ strategy: "fixed", flip: true, shift: true, offset: 8 }} shouldShow={({ state }) => !state.selection.empty && !(state.selection instanceof NodeSelection)} className="z-40 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
        <Button type="button" size="sm" variant={activeEditor.isActive("highlight") ? "secondary" : "ghost"} onClick={() => activeEditor.chain().focus().toggleMark("highlight", { createdBy: currentUserId }).run()}><Highlighter className="size-4" />{t("highlightSelection")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={prepareComment}><MessageSquareText className="size-4" />{t("commentSelection")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => requestWikiTask(activeEditor)}><ClipboardCheck className="size-4" />{tTasks("createTask")}</Button>
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
      <div
        className={`wiki-editor-surface${documentMode ? " wiki-document-canvas" : ""}`}
        style={documentMode ? documentCanvasStyle : editorTypographyStyle}
      >
        <EditorContent editor={editor} data-testid="wiki-editor" data-document-mode={documentMode ? "true" : "false"} />
      </div>
      {spellcheckIssue && <div role="dialog" aria-label={t("editor.proofing.dialog")} className="fixed z-50 max-h-[min(28rem,calc(100vh-2rem))] w-72 overflow-y-auto rounded-lg border bg-popover p-2 shadow-lg" style={{ left: Math.min(spellcheckIssue.rect.left, window.innerWidth - 304), top: Math.min(spellcheckIssue.rect.bottom + 8, window.innerHeight - 210) }}>
        <p className="px-2 pb-1 text-xs font-medium">{t(spellcheckIssue.issue.kind === "spelling" ? "editor.proofing.types.spelling" : "editor.proofing.types.writing")}{spellcheckIssue.issue.category && <span className="font-normal text-muted-foreground"> · {spellcheckIssue.issue.category}</span>}</p>
        <p className="px-2 pb-1 text-xs text-muted-foreground">{spellcheckIssue.issue.message}</p>
        {spellcheckIssue.issue.replacements.length ? spellcheckIssue.issue.replacements.map((replacement) => <Button key={replacement} type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => replaceCurrentProofingIssue(replacement)}>{replacement}</Button>) : <p className="px-2 py-1 text-xs text-muted-foreground">{t("editor.proofing.noReplacement")}</p>}
        <div className="mt-1 border-t pt-1">
          {spellcheckIssue.issue.replacements[0] && <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => replaceAllCurrentProofingIssue(spellcheckIssue.issue.replacements[0])}>{t("editor.proofing.replaceAll")}</Button>}
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={ignoreCurrentProofingIssue}>{t("editor.proofing.ignore")}</Button>
          {spellcheckIssue.issue.kind === "spelling" && <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => void addCurrentWordToDictionary()}>{t("editor.proofing.addToDictionary")}</Button>}
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setSpellcheckIssue(null)}>{t("editor.proofing.close")}</Button>
        </div>
      </div>}
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
      onOpenTypographySettings={() => setTypographyOpen(true)}
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
  <WikiShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} bindings={wikiShortcuts} onBindingsChange={setWikiShortcuts} />
  {typographyOpen && <WikiTypographyDialog
    editorPreferences={{ minimalToolbar, statusVisible, typewriterMode }}
    isPrimaryAuthor={isPrimaryAuthor}
    onApplied={(nextTypography, preferences) => {
      setPersonalTypography(nextTypography);
      if (isPrimaryAuthor) setTypography(nextTypography);
      setMinimalToolbar(preferences.minimalToolbar);
      setStatusVisible(preferences.statusVisible);
      setTypewriterMode(preferences.typewriterMode);
      router.refresh();
    }}
    onOpenChange={setTypographyOpen}
    onTemplatesChange={setPersonalTypographyTemplates}
    open={typographyOpen}
    templates={personalTypographyTemplates}
    typography={personalTypography}
  />}
  <EditorOutlineSheet editor={activeEditor} items={outline} activePosition={activeHeadingPosition} open={outlineOpen} onOpenChange={setOutlineOpen} />
  </div>;
}
