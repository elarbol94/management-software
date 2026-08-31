"use client";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { DOMParser as ProseMirrorDOMParser, Fragment, Slice } from "@tiptap/pm/model";
import { AlertCircle, AlignCenter, AlignLeft, AlignRight, ArrowLeftRight, Bold, BookMarked, CalendarClock, Captions, Check, ClipboardCheck, CloudOff, Code, Columns2, FileText, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic, Keyboard, Languages, Layers3, Link2, List, ListOrdered, ListTree, ListTodo, MessageSquareText, Minus, MoreHorizontal, PanelRightClose, PanelRightOpen, Paperclip, Pilcrow, Quote, Redo2, RotateCcw, Rows3, Scan, ScissorsLineDashed, Search, Settings2, Strikethrough, Trash2, Underline as UnderlineIcon, Undo2, WifiOff, Workflow } from "lucide-react";
import { addComment, restorePageRevision } from "../research-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { collectSpellcheckParagraphs, createSpellcheckBatches, createSpellcheckExtension, getSpellcheckIssues, mapSpellcheckMatches, nextProofingLanguage, PROOFING_LANGUAGES, remapSpellcheckBatchMatches, replaceAllSpellcheckOccurrences, setSpellcheckIssues, type ProofingLanguage, type SpellcheckIssue, type SpellcheckResponseMatch } from "../lib/spellcheck";
import { disableMyWikiProofingRule, ignoreMyWikiProofingIssue, updateMyWikiProofingPicky } from "../wiki-preference-actions";
import type { WikiProofingPrefsV1 } from "../lib/wiki-proofing-prefs";
import { looksLikeMarkdown, parseMarkdownDocument } from "../lib/markdown-import";
import { sanitizePastedHtml } from "../lib/paste-html";
import { calculateWritingStats, type WritingStats } from "../lib/editor-writing";
import { userMarkColorStyle, type UserMarkColor } from "@/lib/user-mark-colors";
import { MermaidDiagram, MERMAID_PLACEHOLDER } from "./mermaid-extension";
import { SuggestionDelete, SuggestionInsert, SuggestionMode } from "./suggestion-extension";
import { acceptSuggestions, countSuggestions, rejectSuggestions } from "../lib/suggestions";
import { DocumentExtensions, getDocumentPaginationBreaks, samePaginationBreaks, setDocumentNumberingConfig, setDocumentPaginationBreaks, type DocumentPaginationBreak } from "./document-extension";
import { computeDocumentPagination, type PaginationItem, type PaginationSplit } from "../lib/document-pagination";
import { DocumentLayoutPanel } from "./document-layout-panel";
import { WikiTypographyDialog, type WikiEditorPreferences } from "./wiki-typography-dialog";
import {
  collectDocumentPreflightIssues,
  localizeDocumentSettings,
  parseDocumentSettings,
  serializeDocumentSettings,
  type DocumentPreflightIssue,
  type DocumentSettingsV1,
} from "../lib/document-settings";
import { hasOwnFigureNumber } from "../lib/figure-caption";
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
  normalizeWikiShortcut,
  parseWikiShortcutBindings,
  WIKI_SHORTCUT_ACTIONS,
  type WikiShortcutAction,
} from "../lib/wiki-shortcuts";
import { displayShortcut } from "../lib/shortcut-display";
import { useTaskCreator } from "@/modules/tasks/components/task-create-provider";
import { useDeadlineCreator } from "@/modules/tasks/components/deadline-create-provider";
import { localDateValue } from "@/modules/tasks/deadline-utils";
import type { ContextDeadlineMarker, ContextTaskMarker } from "@/modules/tasks/types";
import { formatBibliography, formatIeeeCitation, formatInlineCitation, isNumericCitationStyle, type CitationSource, type CitationStyle } from "../lib/citations";
import { NewSourceDialog } from "./new-source-dialog";
import { SvgGraphicsPanel } from "./svg-graphics-panel";
import type { ProposalWorkspaceData } from "../lib/proposal";

type PageRef = { id: string; title: string; slug: string };
type SourceRef = CitationSource;
type WikiEditorPageActions = { addAttachment: () => void; linkSupportingSource: () => void };
export type WikiEditorHandle = {
  insertGraphic: (asset: { attachmentId: string; fileName: string; contentUrl: string; caption?: string | null }) => void;
};
type CachedSpellcheckMatch = Omit<SpellcheckResponseMatch, "paragraph">;
type FigureCaption = { nodeId: string; caption: string };
type TableCaption = { tableId: string; caption: string };
type CitationTarget = { sourceId: string; documentId?: string; annotationId?: string; locator?: string };
type WikiSaveInput = {
  id: string;
  contentJson: string;
  baseContentJson?: string;
  documentMode?: boolean;
  documentSettingsJson?: string;
  baseDocumentMode?: boolean;
  baseDocumentSettingsJson?: string;
  expectedContentVersion: number;
  editorSessionId: string;
};
type WikiSaveResult =
  | { saved: true; conflict: false; contentVersion: number }
  | { saved: false; conflict?: false; locked?: boolean; contentVersion?: number }
  | { saved: false; conflict: true; contentVersion: number; revisionId: string; contentJson: string; documentMode: boolean; documentSettingsJson: string };

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
const DOCUMENT_ZOOM_KEY = "wiki:document-zoom:v1";
const DOCUMENT_ZOOM_MIN = 70;
const DOCUMENT_ZOOM_MAX = 200;
// Typing bursts arrive faster than a frame. Both the page measurement and the
// content snapshot wait out the burst instead of running per keystroke.
const PAGINATION_TYPING_DELAY = 120;
const CONTENT_SYNC_DELAY = 200;
// Line geometry is only measured for blocks that actually reach a page edge, and
// each such block moves the flow, so a couple of rounds settle the whole page.
const PAGINATION_MEASURE_ROUNDS = 3;

// Measures the line boxes of a text block and maps each line start back to a
// document position, so a paragraph or code block can break between its lines.
function measureTextLines(editor: Editor, element: HTMLElement, natural: (value: number) => number) {
  const range = document.createRange();
  const rectAt = (text: Text, offset: number) => {
    if (offset < 0 || offset >= text.length) return null;
    range.setStart(text, offset);
    range.setEnd(text, offset + 1);
    const rect = range.getBoundingClientRect();
    return rect.height > 0 ? rect : null;
  };
  const splits: PaginationSplit[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.length || text.parentElement?.closest("[contenteditable=\"false\"]")) continue;
    let offset = 0;
    while (offset < text.length) {
      const rect = rectAt(text, offset);
      if (!rect) {
        offset += 1;
        continue;
      }
      const top = natural(rect.top);
      const previous = splits[splits.length - 1];
      // A line box can span several text nodes when marks interrupt it.
      if (previous && Math.abs(previous.top - top) < 1) previous.bottom = Math.max(previous.bottom, natural(rect.bottom));
      else splits.push({ position: editor.view.posAtDOM(text, offset), top, bottom: natural(rect.bottom) });
      // Probing every character is too slow on a paragraph that fills a page, so
      // the end of the line box is found by bisection instead.
      let low = offset + 1;
      let high = text.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const probe = rectAt(text, middle - 1);
        if (probe && Math.abs(probe.top - rect.top) < 1) low = middle;
        else high = middle - 1;
      }
      offset = Math.max(low, offset + 1);
    }
  }
  return splits;
}

// ponytail: split tables between rows without repeating the header row on the
// following page; the export renderers own that, this is the on-screen preview.
function measureTableRows(editor: Editor, table: HTMLElement, natural: (value: number) => number) {
  const rows = table.querySelectorAll<HTMLTableRowElement>(":scope > tr, :scope > tbody > tr");
  return Array.from(rows, (row) => {
    const rect = row.getBoundingClientRect();
    return { position: Math.max(0, editor.view.posAtDOM(row, 0) - 1), top: natural(rect.top), bottom: natural(rect.bottom) };
  });
}

function loadDocumentZoom() {
  if (typeof window === "undefined") return 100;
  // Without this guard an absent entry parses as 0 and clamps to the minimum,
  // so a first visit opened the document at 70 % instead of 100 %.
  const stored = Number(window.localStorage.getItem(DOCUMENT_ZOOM_KEY) ?? Number.NaN);
  return Number.isFinite(stored) && stored > 0 ? Math.min(DOCUMENT_ZOOM_MAX, Math.max(DOCUMENT_ZOOM_MIN, stored)) : 100;
}

function scrollableAncestor(element: Element | null, axis: "x" | "y") {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (!/^(auto|scroll|overlay)$/.test(axis === "y" ? style.overflowY : style.overflowX)) continue;
    const scrollable = axis === "y" ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
    if (scrollable > 1) return node;
  }
  return null;
}

// Zooming keeps the point under the cursor in place: whatever the mouse pointed
// at before the wheel notch is scrolled back under the pointer afterwards.
function keepZoomAnchorInPlace(surface: HTMLElement, deltaX: number, deltaY: number) {
  let restX = deltaX;
  let restY = deltaY;
  const horizontal = scrollableAncestor(surface, "x");
  if (horizontal && restX) {
    const before = horizontal.scrollLeft;
    horizontal.scrollLeft = before + restX;
    restX -= horizontal.scrollLeft - before;
  }
  const vertical = scrollableAncestor(surface, "y");
  if (vertical && restY) {
    const before = vertical.scrollTop;
    vertical.scrollTop = before + restY;
    restY -= vertical.scrollTop - before;
  }
  if (Math.abs(restX) > 0.5 || Math.abs(restY) > 0.5) {
    window.scrollBy({ left: restX, top: restY, behavior: "instant" });
  }
}
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
  pageContentVersion: number;
  initialContent: string;
  initialProofingLanguage: ProofingLanguage;
  initialProofingPrefs: WikiProofingPrefsV1;
  initialDocumentMode: boolean;
  initialDocumentSettings: string;
  documentTemplates: StoredDocumentTemplate[];
  allPages: PageRef[];
  sources: SourceRef[];
  users: Array<{ id: string; name: string; markColor: UserMarkColor }>;
  citationLocale: string;
  citationStyle: CitationStyle;
  insertEvidenceId?: string;
  comments: CommentThread[];
  currentUserId: string;
  contextTasks: ContextTaskMarker[];
  contextDeadlines: ContextDeadlineMarker[];
  proposalData: ProposalWorkspaceData;
  focusTaskId?: string;
  focusDeadlineId?: string;
  pageActions: WikiEditorPageActions;
  actionsRef?: RefObject<WikiEditorHandle | null>;
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

function loadBooleanPreference(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  if (stored === null) return fallback;
  return stored === "true";
}

const Citation = Node.create({
  name: "citation", group: "inline", inline: true, atom: true,
  addAttributes() { return { items: { default: [] }, label: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-citation]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-citation": "", class: "wiki-citation" }), HTMLAttributes.label || "(citation)"]; },
});

function citationNumberForSource(editor: Editor, sourceId: string) {
  const order = new Map<string, number>();
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "citation" || !Array.isArray(node.attrs.items)) return;
    for (const item of node.attrs.items as Array<{ sourceId?: unknown }>) {
      if (typeof item.sourceId === "string" && !order.has(item.sourceId)) order.set(item.sourceId, order.size + 1);
    }
  });
  return order.get(sourceId) ?? order.size + 1;
}

function normalizeCitationLabels(
  editor: Editor,
  sources: CitationSource[],
  style: CitationStyle,
  locale: string,
) {
  const order = new Map<string, number>();
  const updates: Array<{ position: number; attrs: Record<string, unknown> }> = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "citation" || !Array.isArray(node.attrs.items)) return;
    const labels: string[] = [];
    for (const item of node.attrs.items as Array<{ sourceId?: unknown; locator?: unknown }>) {
      if (typeof item.sourceId !== "string") continue;
      if (!order.has(item.sourceId)) order.set(item.sourceId, order.size + 1);
      const locator = typeof item.locator === "string" ? item.locator : undefined;
      if (isNumericCitationStyle(style)) {
        labels.push(formatIeeeCitation(order.get(item.sourceId)!, locator));
        continue;
      }
      const source = sources.find((candidate) => candidate.id === item.sourceId);
      labels.push(source
        ? formatInlineCitation(source, locator, locale, order.get(item.sourceId)!, style)
        : formatIeeeCitation(order.get(item.sourceId)!, locator));
    }
    const label = labels.join(", ");
    if (label && node.attrs.label !== label) updates.push({ position, attrs: { ...node.attrs, label } });
  });
  if (!updates.length) return false;
  const transaction = editor.state.tr;
  for (const update of updates) transaction.setNodeMarkup(update.position, undefined, update.attrs);
  editor.view.dispatch(transaction);
  return true;
}

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
      includeInFigureIndex: { default: true },
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
    },
    // bg-white: images with transparency (diagrams exported from Inkscape/Illustrator commonly
    // have none) assume a light backing; the wiki background goes dark in dark mode otherwise.
    ["img", { src: HTMLAttributes.src, alt: HTMLAttributes.alt || label, class: "max-h-[36rem] w-full rounded-lg bg-white object-contain", style: `object-position:${Number(HTMLAttributes.cropX) || 50}% ${Number(HTMLAttributes.cropY) || 50}%` }],
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

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div role="group" aria-label={label} className="flex items-center gap-0.5 rounded-lg bg-muted/55 p-0.5">
    {children}
  </div>;
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
type ExistingImageAttachment = UploadedAttachment & { sizeBytes: number };
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

function isInlineImageFile(file: File) {
  return INLINE_IMAGE_TYPES.has(file.type) || (!file.type && file.name.toLocaleLowerCase().endsWith(".svg"));
}

function isExistingInlineImage(attachment: ExistingImageAttachment) {
  return INLINE_IMAGE_TYPES.has(attachment.mimeType) || attachment.fileName.toLocaleLowerCase().endsWith(".svg");
}

function normalizeInlineImageFile(file: File) {
  return !file.type && file.name.toLocaleLowerCase().endsWith(".svg")
    ? new File([file], file.name, { type: "image/svg+xml", lastModified: file.lastModified })
    : file;
}

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
  const label = attachment.fileName.replace(/\.[^.]+$/, "");
  return {
    nodeId: crypto.randomUUID(),
    attachmentId: attachment.id,
    src: `/api/files/${attachment.id}`,
    alt: label,
    caption: label,
    includeInFigureIndex: true,
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
  const t = useTranslations("wiki");
  const common = useTranslations("common");
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
    aria-label={t("selectImageRegion")}
  >
    <button type="button" aria-label={common("cancel")} title={common("cancel")} className="absolute top-2 right-2 rounded bg-background/95 px-2 py-1 text-xs shadow" onPointerDown={(event) => event.stopPropagation()} onClick={onCancel}>×</button>
    {preview && <div className="absolute border-2 border-amber-600 bg-amber-300/30" style={{ left: `${preview.x * 100}%`, top: `${preview.y * 100}%`, width: `${preview.width * 100}%`, height: `${preview.height * 100}%` }} />}
  </div>;
}

function PageLinkPicker({ editor, pages, open, onOpenChange }: { editor: Editor; pages: PageRef[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("wiki"); const [query, setQuery] = useState("");
  return <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" title={t("linkPage")} aria-label={t("linkPage")} />}><Link2 className="size-4" /></PopoverTrigger><PopoverContent className="w-72 p-2"><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filterPages")} className="mb-2 h-8" /><div className="max-h-60 overflow-y-auto">{pages.filter((page) => page.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((page) => <button key={page.id} type="button" className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { const { empty } = editor.state.selection; const href = `/wiki/pages/${page.slug}`; if (empty) editor.chain().focus().insertContent({ type: "text", text: page.title, marks: [{ type: "link", attrs: { href } }] }).run(); else editor.chain().focus().setLink({ href }).run(); onOpenChange(false); }}>{page.title}</button>)}</div></PopoverContent></Popover>;
}

function CitationPicker({ editor, sources, locale, pageSlug, open, onOpenChange }: { editor: Editor; sources: SourceRef[]; locale: string; pageSlug: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("wiki"); const [query, setQuery] = useState(""); const [locator, setLocator] = useState("");
  function preview(source: SourceRef) { return formatInlineCitation(source, locator, locale, citationNumberForSource(editor, source.id)); }
  function insert(source: SourceRef) { const label = preview(source); editor.chain().focus().insertContent({ type: "citation", attrs: { items: [{ sourceId: source.id, locator: locator || undefined, locatorType: "page" }], label } }).run(); onOpenChange(false); setLocator(""); setQuery(""); }
  const filtered = sources.filter((source) => `${source.title} ${source.contributors.map((person) => `${person.given} ${person.family} ${person.literal}`).join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger render={<Button type="button" variant="ghost" size="sm" className="gap-1.5 px-2 text-xs" title={t("citeSource")} aria-label={t("citeSource")} />}><BookMarked className="size-4" /><span className="hidden 2xl:inline">{t("citeSource")}</span></PopoverTrigger><PopoverContent className="w-96 p-2"><div className="grid grid-cols-[1fr_5rem] gap-2"><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("findSource")} className="h-8" /><Input value={locator} onChange={(event) => setLocator(event.target.value)} placeholder={t("pageShort")} className="h-8" /></div><div className="mt-2 max-h-64 overflow-y-auto">{filtered.map((source) => <button key={source.id} type="button" className="block w-full rounded px-2 py-2 text-left hover:bg-accent" onClick={() => insert(source)}><span className="block text-sm font-medium">{source.title}</span><span className="text-xs text-muted-foreground">{preview(source)}</span></button>)}</div><div className="mt-2 flex items-center justify-between border-t pt-2"><span className="text-[11px] text-muted-foreground">IEEE</span><NewSourceDialog compactButton redirectTo={`/wiki/pages/${pageSlug}`} /></div></PopoverContent></Popover>;
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequest = useRef(0);

  async function load(search = "") {
    const request = ++searchRequest.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/wiki/evidence?targetType=wikiPage&targetId=${encodeURIComponent(pageId)}&q=${encodeURIComponent(search)}`);
      if (response.ok) {
        const body = await response.json() as { available: EvidenceRef[] };
        // A slower earlier request must not overwrite a newer result.
        if (searchRequest.current === request) setItems(body.available);
      }
    } finally {
      if (searchRequest.current === request) setLoading(false);
    }
  }

  /** Debounced like every other search in the module, instead of waiting for a button. */
  function updateQuery(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void load(value);
    }, 220);
  }

  function searchNow() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    void load(query);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function insert(item: EvidenceRef) {
    editor.chain().focus().insertContent(evidenceInsertContent(item, locale)).run();
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
          <Input autoFocus value={query} onChange={(event) => updateQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchNow(); } }} placeholder={t("findEvidence")} className="h-8" />
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

/** The evidence block plus its citation, shared by the picker and the reader hand-off. */
function evidenceInsertContent(item: EvidenceRef, locale: string) {
    const pageLabel = locale.startsWith("de") ? "S." : "p.";
    return [
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
            items: [{ sourceId: item.sourceId, documentId: item.documentId, annotationId: item.id, locator: String(item.pageNumber), locatorType: "page" }],
            label: `(${item.sourceTitle}, ${pageLabel} ${item.pageNumber})`,
          },
        }],
      },
    ];
}


export function WikiEditor({
  focused = false,
  pageId,
  pageTitle,
  pageSlug,
  pageVersion,
  pageContentVersion,
  initialContent,
  initialProofingLanguage,
  initialProofingPrefs,
  initialDocumentMode,
  initialDocumentSettings,
  documentTemplates,
  allPages,
  sources,
  users,
  citationLocale,
  citationStyle,
  insertEvidenceId,
  comments,
  contextTasks,
  contextDeadlines,
  proposalData,
  focusTaskId,
  focusDeadlineId,
  currentUserId,
  pageActions,
  actionsRef,
  initialTypography,
  editableTypography,
  typographyTemplates,
  isPrimaryAuthor,
}: WikiEditorProps) {
  const t = useTranslations("wiki"); const tTasks = useTranslations("tasks"); const tDeadlines = useTranslations("deadlines"); const format = useFormatter(); const router = useRouter(); const searchParams = useSearchParams(); const externalSearchQuery = searchParams.get("search")?.trim() ?? ""; const { openTaskCreator } = useTaskCreator(); const { openDeadlineCreator } = useDeadlineCreator(); const [saveState, setSaveState] = useState<"idle" | "unsaved" | "saving" | "saved" | "offline" | "error" | "conflict">("idle");
  const localizedInitialDocumentSettings = localizeDocumentSettings(
    parseDocumentSettings(initialDocumentSettings),
    citationLocale,
  );
  const [conflictRevision, setConflictRevision] = useState<string | null>(null); const [activeThreadId, setActiveThreadId] = useState<string | null>(null); const [optimisticCommentThreads, setOptimisticCommentThreads] = useState<CommentThread[]>([]); const [commentFocusRequest, setCommentFocusRequest] = useState(0); const [inlineImagePickerOpen, setInlineImagePickerOpen] = useState(false); const [existingImages, setExistingImages] = useState<ExistingImageAttachment[]>([]); const [existingImagesLoading, setExistingImagesLoading] = useState(false); const [existingImagesError, setExistingImagesError] = useState(""); const [commentOpen, setCommentOpen] = useState(false); const [commentBody, setCommentBody] = useState(""); const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null); const [regionTarget, setRegionTarget] = useState<{ nodeId: string; label: string } | null>(null); const [imageError, setImageError] = useState(""); const [imageUploading, setImageUploading] = useState(false); const [assigneeId, setAssigneeId] = useState("none");
  const commentThreads = useMemo(
    () => [...optimisticCommentThreads.filter((thread) => !comments.some((item) => item.id === thread.id)), ...comments],
    [comments, optimisticCommentThreads],
  );
  const [pageLinkOpen, setPageLinkOpen] = useState(false); const [citationOpen, setCitationOpen] = useState(false); const [evidenceOpen, setEvidenceOpen] = useState(false); const [markdownHelpOpen, setMarkdownHelpOpen] = useState(false); const [shortcutsOpen, setShortcutsOpen] = useState(false); const [linkEditorRequest, setLinkEditorRequest] = useState(0);
  const [graphicsOpen, setGraphicsOpen] = useState(false);
  const [manualSearchOpen, setManualSearchOpen] = useState(false);
  const searchOpen = manualSearchOpen || Boolean(externalSearchQuery);
  function changeSearchOpen(open: boolean) {
    setManualSearchOpen(open);
    if (!open && externalSearchQuery) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("search");
      router.replace(`${window.location.pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    }
  }
  const [outlineOpen, setOutlineOpen] = useState(false); const [outline, setOutline] = useState<OutlineItem[]>([]); const [activeHeadingPosition, setActiveHeadingPosition] = useState<number | null>(null);
  const [writingStats, setWritingStats] = useState<WritingStats>({ words: 0, characters: 0, selectedWords: 0, readingMinutes: 0 });
  // TipTap v3 no longer re-renders per transaction, so the toolbar needs an
  // explicit nudge to show the marks under the caret. It stays on the keystroke
  // path because it is cheap; the document-wide derived state does not.
  const [, refreshToolbarState] = useReducer((value: number) => value + 1, 0);
  const [documentMode, setDocumentMode] = useState(initialDocumentMode);
  const [documentSettings, setDocumentSettings] = useState<DocumentSettingsV1>(() => localizedInitialDocumentSettings);
  const [documentIssues, setDocumentIssues] = useState<DocumentPreflightIssue[]>([]);
  const [documentPageCount, setDocumentPageCount] = useState(1);
  const [documentZoom, setDocumentZoom] = useState(loadDocumentZoom);
  const appliedZoom = useRef(documentZoom);
  const zoomAnchor = useRef<{ clientX: number; clientY: number; contentX: number; contentY: number } | null>(null);
  const captureZoomAnchorRef = useRef<(clientX: number, clientY: number) => void>(() => {});
  const [figureCaptions, setFigureCaptions] = useState<FigureCaption[]>([]);
  const [tableCaptions, setTableCaptions] = useState<TableCaption[]>([]);
  const [citedSourceIds, setCitedSourceIds] = useState<string[]>([]);
  const [citationTargets, setCitationTargets] = useState<CitationTarget[]>([]);
  const [typography, setTypography] = useState(() => normalizeWikiTypography(initialTypography));
  const [personalTypography, setPersonalTypography] = useState(() => normalizeWikiTypography(editableTypography));
  const [personalTypographyTemplates, setPersonalTypographyTemplates] = useState(typographyTemplates);
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [imageDescriptionOpen, setImageDescriptionOpen] = useState(false);
  const [imageCaptionDraft, setImageCaptionDraft] = useState("");
  const [imageAltDraft, setImageAltDraft] = useState("");
  const [imageInFigureIndexDraft, setImageInFigureIndexDraft] = useState(true);
  const [spellcheckIssue, setSpellcheckIssue] = useState<{ issue: SpellcheckIssue; rect: DOMRect } | null>(null);
  const [proofingLanguage, setProofingLanguage] = useState<ProofingLanguage>(initialProofingLanguage);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionCounts, setSuggestionCounts] = useState({ inserted: 0, deleted: 0 });
  const [proofingStatus, setProofingStatus] = useState<"ready" | "checking" | "error">("checking");
  const [proofingSaving, setProofingSaving] = useState(false);
  const proofingCache = useRef(new Map<string, CachedSpellcheckMatch[]>());
  const [proofingDictionary, setProofingDictionary] = useState<string[]>([]);
  const [proofingDictionaryLoaded, setProofingDictionaryLoaded] = useState(false);
  const [proofingPicky, setProofingPicky] = useState(initialProofingPrefs.picky);
  const ignoredProofingIssues = useRef(new Set<string>(initialProofingPrefs.ignoredIssueKeys));
  const disabledProofingRuleIds = useRef(new Set<string>(initialProofingPrefs.disabledRuleIds));
  const [wikiShortcuts, setWikiShortcuts] = useState(loadWikiShortcutBindings);
  const [initialPreferences] = useState(loadEditorPreferences);
  const [statusVisible, setStatusVisible] = useState(initialPreferences.statusVisible); const [minimalToolbar, setMinimalToolbar] = useState(initialPreferences.minimalToolbar); const [typewriterMode, setTypewriterMode] = useState(initialPreferences.typewriterMode); const typewriterModeRef = useRef(initialPreferences.typewriterMode);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const maxSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const contentSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const contentSyncEditor = useRef<Editor | null>(null); const liveEditor = useRef<Editor | null>(null); const contentSyncDirty = useRef(false); const flushContentSyncRef = useRef<() => void>(() => {}); const contentVersion = useRef(pageContentVersion); const lastServerContent = useRef(initialContent); const lastServerDocumentMode = useRef(initialDocumentMode); const lastServerDocumentSettings = useRef(serializeDocumentSettings(localizedInitialDocumentSettings)); const documentModeRef = useRef(initialDocumentMode); const documentSettingsRef = useRef(localizedInitialDocumentSettings); const pendingSave = useRef<string | null>(null); const queuedSave = useRef<string | null>(null); const saveInFlight = useRef(false); const persistContentRef = useRef<(json: string) => Promise<void>>(async () => {}); const conflictBlocked = useRef(false); const editorSessionId = useRef(globalThis.crypto.randomUUID()); const selection = useRef<{ from: number; to: number } | null>(null); const toolbarSelection = useRef<{ from: number; to: number } | null>(null); const imageInputRef = useRef<HTMLInputElement>(null); const editorRootRef = useRef<HTMLDivElement>(null); const commentRailRef = useRef<CommentRailHandle>(null);
  const [leaseState, setLeaseState] = useState<"checking" | "editable" | "locked">("checking");
  const leaseStateRef = useRef<"checking" | "editable" | "locked">("checking");
  const recoveryApplied = useRef(false);
  const commentsPreferenceKey = `wiki:page:${pageId}:comments-visible`;
  const layoutPreferenceKey = `wiki:page:${pageId}:document-layout-visible`;
  const [commentsVisible, setCommentsVisible] = useState(() => loadBooleanPreference(commentsPreferenceKey, false));
  const [documentLayoutVisible, setDocumentLayoutVisible] = useState(() => loadBooleanPreference(layoutPreferenceKey, false));
  const storageKey = `wiki-draft:${pageId}`; const preferencesKey = `wiki-editor-preferences`;
  let content: object | undefined; try { content = initialContent ? JSON.parse(initialContent) : undefined; } catch { content = undefined; }
  if (typeof window !== "undefined") {
    const draft = window.localStorage.getItem(storageKey);
    if (draft && draft !== initialContent) {
      try {
        const parsed = JSON.parse(draft) as ({ contentJson?: string } & object) | null;
        content = parsed && "contentJson" in parsed && typeof parsed.contentJson === "string"
          ? JSON.parse(parsed.contentJson)
          : parsed ?? undefined;
      } catch { /* ignore damaged recovery */ }
    }
  }

  function updateDerivedState(currentEditor: Editor) {
    setSuggestionCounts(countSuggestions(currentEditor.getJSON() as never));
    const items: OutlineItem[] = [];
    const captions: FigureCaption[] = [];
    const tables: TableCaption[] = [];
    const citations = new Set<string>();
    const targets = new Map<string, CitationTarget>();
    currentEditor.state.doc.descendants((node, position) => {
      if (node.type.name === "heading") items.push({ level: Number(node.attrs.level), text: node.textContent, position, id: String(node.attrs.id ?? `heading-${position}`) });
      if (node.type.name === "commentableImage" && node.attrs.includeInFigureIndex !== false && String(node.attrs.caption ?? "").trim()) {
        captions.push({ nodeId: String(node.attrs.nodeId ?? `figure-${position}`), caption: String(node.attrs.caption).trim() });
      }
      if (node.type.name === "markdownTable" && node.attrs.includeInTableIndex !== false && String(node.attrs.caption ?? "").trim()) {
        tables.push({ tableId: String(node.attrs.tableId ?? ("table-" + position)), caption: String(node.attrs.caption).trim() });
      }
      if (node.type.name === "citation" && Array.isArray(node.attrs.items)) {
        for (const item of node.attrs.items as Array<{ sourceId?: unknown; documentId?: unknown; annotationId?: unknown; locator?: unknown }>) {
          if (typeof item.sourceId === "string") {
            citations.add(item.sourceId);
            if (!targets.has(item.sourceId)) {
              targets.set(item.sourceId, {
                sourceId: item.sourceId,
                ...(typeof item.documentId === "string" && item.documentId ? { documentId: item.documentId } : {}),
                ...(typeof item.annotationId === "string" && item.annotationId ? { annotationId: item.annotationId } : {}),
                ...(typeof item.locator === "string" && item.locator ? { locator: item.locator } : {}),
              });
            }
          }
        }
      }
    });
    setOutline(items);
    setFigureCaptions(captions);
    setTableCaptions(tables);
    setCitedSourceIds([...citations]);
    setCitationTargets([...targets.values()]);
    const cursor = currentEditor.state.selection.from;
    setActiveHeadingPosition([...items].reverse().find((item) => item.position < cursor)?.position ?? null);
    setWritingStats(calculateWritingStats(currentEditor.state.doc, currentEditor.state.selection));
    setDocumentIssues(collectDocumentPreflightIssues(currentEditor.getJSON(), documentSettingsRef.current));
  }

  // Walking the document, serializing it and re-rendering the editor shell on
  // every keystroke is what made writing feel heavy. The work now runs at most
  // once per CONTENT_SYNC_DELAY, and the timer is never pushed back, so a long
  // typing burst still snapshots regularly.
  function flushContentSync() {
    if (contentSyncTimer.current) {
      clearTimeout(contentSyncTimer.current);
      contentSyncTimer.current = null;
    }
    const currentEditor = contentSyncEditor.current;
    if (!currentEditor) return;
    contentSyncEditor.current = null;
    updateDerivedState(currentEditor);
    if (!contentSyncDirty.current) return;
    contentSyncDirty.current = false;
    const json = JSON.stringify(currentEditor.getJSON());
    localStorage.setItem(storageKey, JSON.stringify({
      contentJson: json,
      documentMode: documentModeRef.current,
      documentSettingsJson: serializeDocumentSettings(documentSettingsRef.current),
      baseContentVersion: contentVersion.current,
      editorSessionId: editorSessionId.current,
      savedAt: Date.now(),
    }));
    pendingSave.current = json;
    if (conflictBlocked.current) { setSaveState("conflict"); return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persistLatestContent, 2_000);
    if (!maxSaveTimer.current) {
      maxSaveTimer.current = setTimeout(() => {
        maxSaveTimer.current = null;
        persistLatestContent();
      }, 10_000);
    }
  }
  flushContentSyncRef.current = flushContentSync;

  // A save takes its snapshot when the timer fires, never when it was armed:
  // a request carrying text from a moment ago would drop the local journal of
  // the newer keystrokes once the server confirmed it.
  function persistLatestContent() {
    const json = liveEditor.current ? JSON.stringify(liveEditor.current.getJSON()) : pendingSave.current;
    if (json) void persistContent(json);
  }

  // Remember where the pointer sits on the page so the next zoom step can put
  // that exact spot back under it. Coordinates outside the visible page (toolbar
  // and keyboard zoom, events without pointer position) fall back to the nearest
  // visible point instead of dragging the page to a corner.
  function captureZoomAnchor(clientX: number, clientY: number) {
    const surface = editorRootRef.current?.querySelector<HTMLElement>(".wiki-editor-surface");
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const anchorX = Math.min(Math.max(clientX, left), Math.max(left, Math.min(rect.right, window.innerWidth)));
    const anchorY = Math.min(Math.max(clientY, top), Math.max(top, Math.min(rect.bottom, window.innerHeight)));
    const scale = appliedZoom.current / 100;
    zoomAnchor.current = {
      clientX: anchorX,
      clientY: anchorY,
      contentX: (anchorX - rect.left) / scale,
      contentY: (anchorY - rect.top) / scale,
    };
  }
  captureZoomAnchorRef.current = captureZoomAnchor;


  function scheduleContentSync(currentEditor: Editor, changed: boolean) {
    liveEditor.current = currentEditor;
    contentSyncEditor.current = currentEditor;
    if (changed) contentSyncDirty.current = true;
    if (contentSyncTimer.current) return;
    contentSyncTimer.current = setTimeout(() => flushContentSyncRef.current(), CONTENT_SYNC_DELAY);
  }

  async function persistContent(json: string, attempt = 0) {
    pendingSave.current = json;
    if (leaseStateRef.current !== "editable") { setSaveState(leaseStateRef.current === "locked" ? "conflict" : "unsaved"); return; }
    if (typeof navigator !== "undefined" && !navigator.onLine) { setSaveState("offline"); return; }
    if (conflictBlocked.current) { setSaveState("conflict"); return; }
    if (saveInFlight.current) { queuedSave.current = json; return; }
    saveInFlight.current = true;
    setSaveState("saving");
    try {
      const settingsJson = serializeDocumentSettings(documentSettingsRef.current);
      const result = await savePageContentRequest({
        id: pageId,
        contentJson: json,
        baseContentJson: lastServerContent.current,
        documentMode: documentModeRef.current,
        documentSettingsJson: settingsJson,
        baseDocumentMode: lastServerDocumentMode.current,
        baseDocumentSettingsJson: lastServerDocumentSettings.current,
        expectedContentVersion: contentVersion.current,
        editorSessionId: editorSessionId.current,
      });
      if (result.saved) {
        contentVersion.current = result.contentVersion;
        lastServerContent.current = json;
        lastServerDocumentMode.current = documentModeRef.current;
        lastServerDocumentSettings.current = settingsJson;
        pendingSave.current = null;
        conflictBlocked.current = false;
        localStorage.removeItem(storageKey);
        setConflictRevision(null);
        setSaveState("saved");
        if (maxSaveTimer.current) {
          clearTimeout(maxSaveTimer.current);
          maxSaveTimer.current = null;
        }
      } else if ("conflict" in result && result.conflict) {
        contentVersion.current = result.contentVersion;
        conflictBlocked.current = true;
        setConflictRevision(result.revisionId);
        setSaveState("conflict");
      } else if ("locked" in result && result.locked) {
        leaseStateRef.current = "locked";
        setLeaseState("locked");
        setSaveState("conflict");
      }
    } catch {
      setSaveState(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
      if (attempt < 2) saveTimer.current = setTimeout(() => void persistContent(json, attempt + 1), 1_000 * (2 ** attempt));
    } finally {
      saveInFlight.current = false;
      const queued = queuedSave.current;
      queuedSave.current = null;
      if (queued && queued !== json && !conflictBlocked.current) void persistContent(queued);
    }
  }
  persistContentRef.current = (json: string) => persistContent(json);

  async function takeOverEditing() {
    const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/lease`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "takeover", sessionId: editorSessionId.current }),
    });
    if (!response.ok) {
      toast.error(t("editor.lease.takeoverFailed"));
      return;
    }
    leaseStateRef.current = "editable";
    setLeaseState("editable");
    conflictBlocked.current = false;
    setSaveState(pendingSave.current ? "unsaved" : "idle");
    if (pendingSave.current) void persistContentRef.current(pendingSave.current);
  }

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
    slash("inlineImage", "wiki", ImagePlus, () => openInlineImagePicker()),
    slash("mermaidDiagram", "wiki", Workflow, (editor) => {
      editor.chain().focus().insertContent({ type: "mermaidDiagram", attrs: { code: MERMAID_PLACEHOLDER, svg: "" } }).run();
    }),
    slash("attachment", "wiki", Paperclip, () => pageActions.addAttachment()),
    slash("supportingSource", "wiki", BookMarked, () => pageActions.linkSupportingSource()),
    slash("pageComment", "wiki", MessageSquareText, () => {
      setCommentsVisible(true);
      setCommentFocusRequest((value) => value + 1);
    }),
    // The document layout panel's Content tab already has a target picker covering
    // headings, figures, tables and annexes — open it rather than duplicating it here.
    slash("crossReference", "wiki", Link2, () => setDocumentLayoutVisible(true)),
  ];
  const slashExtension = createSlashCommandExtension({ commands: slashCommands, ariaLabel: t("slash.ariaLabel"), emptyLabel: t("slash.empty") });

  const editor = useEditor({ immediatelyRender: false, editable: false, enableInputRules: ["blockquote", "bulletList", "codeBlock", "heading", "orderedList", "taskItem"], extensions: [StarterKit.configure({ bold: false, code: false, heading: false, listItem: false, italic: false, link: { openOnClick: false }, strike: false }), CollapsibleHeading.configure({ levels: [1, 2, 3] }), HeadingListItem, ...MarkdownShortcutMarks, ...MarkdownDocumentExtensions, ...DocumentExtensions, TaskList, TaskItem.configure({ nested: true }), Citation, PdfEvidence, TaskReference, DeadlineReference, CommentableImage, MermaidDiagram, CommentMark, SuggestionInsert, SuggestionDelete, SuggestionMode, Highlight, Placeholder.configure({ placeholder: ({ node }) => node.type.name === "heading" ? t("editor.placeholder.heading") : t("editor.placeholder.empty") }), EditorSearchExtension, createSpellcheckExtension((issue, target) => setSpellcheckIssue({ issue, rect: target.getBoundingClientRect() })), MarkdownShortcuts, slashExtension], content,
    editorProps: {
      attributes: { class: "prose prose-neutral dark:prose-invert max-w-none min-h-[28rem] focus:outline-none", spellcheck: "false" },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter(isInlineImageFile).map(normalizeInlineImageFile);
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
        if (!clipboard) return false;
        const plainText = clipboard.getData("text/plain");
        // Raw markdown text takes priority over any HTML the clipboard also carries:
        // many sources (browsers, note apps) wrap even a plain-text copy in an HTML
        // format that adds no real structure, which used to make pasted "#### Heading"
        // fall into the HTML branch below and show up as literal punctuation.
        if (looksLikeMarkdown(plainText)) {
          try {
            const parsed = parseMarkdownDocument(plainText);
            const nodes = (parsed.content ?? []).map((node) => view.state.schema.nodeFromJSON(node));
            event.preventDefault();
            view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0)).scrollIntoView());
            return true;
          } catch {
            // Not actually parseable as markdown - fall through to HTML/plain-text handling.
          }
        }
        const html = clipboard.getData("text/html");
        if (html) {
          // Sanitize first, then hand off to the schema's own DOMParser: it already
          // keeps only the nodes/marks each extension's parseHTML() rule recognizes
          // and silently drops everything else, so no hand-rolled HTML->Tiptap
          // converter is needed here.
          const { html: sanitized, hadImages } = sanitizePastedHtml(html);
          const container = document.createElement("div");
          container.innerHTML = sanitized;
          const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container, { preserveWhitespace: true });
          event.preventDefault();
          view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
          if (hadImages) toast.info(t("editor.paste.imagesDropped"));
          return true;
        }
        return false;
      },
      handleDrop(view, event) {
        const files = [...(event.dataTransfer?.files ?? [])].filter(isInlineImageFile).map(normalizeInlineImageFile);
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
    onCreate({ editor }) {
      liveEditor.current = editor;
      backfillCommentNodeIds(editor);
      if (!normalizeCitationLabels(editor, sources, citationStyle, citationLocale)) updateDerivedState(editor);
    },
    onUpdate({ editor }) {
      if (normalizeCitationLabels(editor, sources, citationStyle, citationLocale)) return;
      if (conflictBlocked.current) setSaveState("conflict");
      else setSaveState("unsaved");
      refreshToolbarState();
      scheduleContentSync(editor, true);
    },
    onSelectionUpdate({ editor }) {
      refreshToolbarState();
      scheduleContentSync(editor, false);
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

  useEffect(() => {
    if (!editor || recoveryApplied.current) return;
    recoveryApplied.current = true;
    const draft = window.localStorage.getItem(storageKey);
    if (!draft) return;
    try {
      const recovered = JSON.parse(draft) as {
        contentJson?: unknown;
        documentMode?: unknown;
        documentSettingsJson?: unknown;
      };
      if (typeof recovered.contentJson !== "string" || recovered.contentJson === initialContent) return;
      pendingSave.current = recovered.contentJson;
      let recoveredMode: boolean | undefined;
      let recoveredSettings: DocumentSettingsV1 | undefined;
      if (typeof recovered.documentMode === "boolean") {
        documentModeRef.current = recovered.documentMode;
        recoveredMode = recovered.documentMode;
      }
      if (typeof recovered.documentSettingsJson === "string") {
        const settings = localizeDocumentSettings(
          parseDocumentSettings(recovered.documentSettingsJson),
          citationLocale,
        );
        documentSettingsRef.current = settings;
        recoveredSettings = settings;
      }
      const applyRecoveredLayout = window.setTimeout(() => {
        if (recoveredMode !== undefined) setDocumentMode(recoveredMode);
        if (recoveredSettings) {
          setDocumentSettings(recoveredSettings);
          setDocumentIssues(collectDocumentPreflightIssues(editor.getJSON(), recoveredSettings));
        }
        setSaveState("unsaved");
      }, 0);
      return () => window.clearTimeout(applyRecoveredLayout);
    } catch {
      // A damaged local journal must never prevent the server version from opening.
    }
  }, [citationLocale, editor, initialContent, storageKey]);

  useEffect(() => {
    if (!editor) return;
    const requestLease = async (action: "acquire" | "heartbeat" | "takeover" | "release") => {
      const response = await fetch(`/api/wiki/pages/${encodeURIComponent(pageId)}/lease`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionId: editorSessionId.current }),
        keepalive: action === "release",
      });
      if (!response.ok) throw new Error("Edit lease failed");
      return response.json() as Promise<{ editable?: boolean }>;
    };
    let disposed = false;
    void requestLease("acquire")
      .then((result) => {
        if (disposed) return;
        const nextLeaseState = result.editable ? "editable" : "locked";
        leaseStateRef.current = nextLeaseState;
        setLeaseState(nextLeaseState);
        if (nextLeaseState === "editable" && pendingSave.current) void persistContentRef.current(pendingSave.current);
      })
      .catch(() => {
        if (!disposed) {
          leaseStateRef.current = "locked";
          setLeaseState("locked");
        }
      });
    const heartbeat = window.setInterval(() => {
      if (disposed) return;
      void requestLease("heartbeat").then((result) => {
        if (!disposed && !result.editable) {
          leaseStateRef.current = "locked";
          setLeaseState("locked");
        }
      }).catch(() => undefined);
    }, 15_000);
    const release = () => {
      // Snapshot whatever was typed inside the last sync window before leaving.
      flushContentSyncRef.current();
      if (pendingSave.current) {
        localStorage.setItem(storageKey, JSON.stringify({
          contentJson: pendingSave.current,
          documentMode: documentModeRef.current,
          documentSettingsJson: serializeDocumentSettings(documentSettingsRef.current),
          baseContentVersion: contentVersion.current,
          editorSessionId: editorSessionId.current,
          savedAt: Date.now(),
        }));
      }
      void requestLease("release").catch(() => undefined);
    };
    window.addEventListener("pagehide", release);
    return () => {
      disposed = true;
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", release);
      void requestLease("release").catch(() => undefined);
    };
  }, [editor, pageId, storageKey]);
  useEffect(() => { editor?.setEditable(leaseState === "editable"); }, [editor, leaseState]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (maxSaveTimer.current) clearTimeout(maxSaveTimer.current);
    if (contentSyncTimer.current) clearTimeout(contentSyncTimer.current);
  }, [editor]);
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
          const cached = proofingCache.current.get(`${proofingLanguage}\u0000${proofingPicky}\u0000${item.text}`);
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
            picky: proofingPicky,
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
          proofingCache.current.set(`${proofingLanguage}\u0000${proofingPicky}\u0000${item.text}`, itemMatches);
          if (proofingCache.current.size > 500) {
            const oldestKey = proofingCache.current.keys().next().value;
            if (typeof oldestKey === "string") proofingCache.current.delete(oldestKey);
          }
        }
        matches.push(...remapSpellcheckBatchMatches(requestBatch, payload.matches));
      }
      return mapSpellcheckMatches(paragraphs, matches)
        .filter((issue) => !ignoredProofingIssues.current.has(proofingIssueKey(issue)))
        .filter((issue) => !disabledProofingRuleIds.current.has(issue.ruleId));
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
        const currentIssues = getSpellcheckIssues(editor).filter((issue) => !priorityParagraphs.some((paragraph) => {
          const paragraphEnd = paragraph.from + paragraph.text.length;
          return issue.from < paragraphEnd && paragraph.from < issue.to;
        }));
        setSpellcheckIssues(editor, [...currentIssues, ...priorityIssues].sort((left, right) => left.from - right.from));

        const fullIssues = paragraphs.length === 1 ? priorityIssues : await requestProofing(paragraphs, activeController);
        if (checkGeneration !== generation || activeController.signal.aborted) return;
        setSpellcheckIssues(editor, fullIssues);
        setProofingStatus("ready");
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (checkGeneration !== generation) return;
        setProofingStatus("error");
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      controller?.abort();
      generation += 1;
      setSpellcheckIssue(null);
      timer = setTimeout(() => void check(generation), 140);
    };
    editor.on("update", schedule);
    void check(++generation);
    return () => {
      generation += 1;
      if (timer) clearTimeout(timer);
      controller?.abort();
      editor.off("update", schedule);
    };
  }, [editor, pageId, proofingDictionary, proofingDictionaryLoaded, proofingLanguage, proofingPicky]);
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.spellcheck = proofingStatus === "error";
  }, [editor, proofingStatus]);
  useEffect(() => {
    if (!editor) return;
    if (!documentMode) {
      setDocumentPaginationBreaks(editor, []);
      return;
    }

    let frame = 0;
    let typingTimer: ReturnType<typeof setTimeout> | null = null;
    const paginate = () => {
      const canvas = editorRootRef.current?.querySelector<HTMLElement>(".wiki-document-canvas");
      const proseMirror = editor.view.dom;
      if (!canvas || !proseMirror.isConnected) return;
      // Dispatching into a running composition drops dead keys and IME candidates.
      // The update that ends the composition schedules the next run.
      if (editor.view.composing) return;

      // The spacers are removed, measured against and restored within this single
      // frame, so no paint ever shows the collapsed page stack.
      const previousBreaks = getDocumentPaginationBreaks(editor);
      if (previousBreaks.length) setDocumentPaginationBreaks(editor, []);

      const portraitWidthMm = documentSettings.page.size === "A4" ? 210 : 215.9;
      const portraitHeightMm = documentSettings.page.size === "A4" ? 297 : 279.4;
      const paperWidthMm = documentSettings.page.orientation === "portrait" ? portraitWidthMm : portraitHeightMm;
      const paperHeightMm = documentSettings.page.orientation === "portrait" ? portraitHeightMm : portraitWidthMm;
      const zoomFactor = documentZoom / 100;
      const pixelsPerMm = canvas.offsetWidth / paperWidthMm;
      const pageHeight = paperHeightMm * pixelsPerMm;
      const pageGap = 12 * pixelsPerMm;
      const marginTop = documentSettings.page.marginsMm.top * pixelsPerMm;
      const marginBottom = documentSettings.page.marginsMm.bottom * pixelsPerMm;
      const usableHeight = pageHeight - marginTop - marginBottom;
      const canvasTop = canvas.getBoundingClientRect().top;
      const natural = (value: number) => (value - canvasTop) / zoomFactor;

      const elements: HTMLElement[] = [];
      const items: PaginationItem[] = [];
      const collectPaginationElements = (element: HTMLElement) => {
        if (element.classList.contains("wiki-document-auto-page-break")) return;
        const rect = element.getBoundingClientRect();
        const elementHeight = rect.height / zoomFactor;
        const canSplit = element.matches("ul, ol, li, blockquote, section[data-document-columns]");
        if (canSplit && elementHeight > usableHeight && element.children.length > 0) {
          for (const child of Array.from(element.children) as HTMLElement[]) collectPaginationElements(child);
          return;
        }
        const isTable = element.matches("table");
        elements.push(element);
        items.push({
          position: Math.max(0, editor.view.posAtDOM(element, 0) - 1),
          top: natural(rect.top),
          bottom: natural(rect.bottom),
          kind: element.tagName === "LI" ? "listItem" : "block",
          splitKind: isTable ? "tableRow" : "inline",
          splittable: isTable || element.matches("p, pre, li, blockquote"),
          pageBreak: element.hasAttribute("data-document-page-break"),
          heading: /^H[1-6]$/.test(element.tagName),
          keepWithNext: element.hasAttribute("data-keep-with-next"),
          keepTogether: element.hasAttribute("data-keep-together"),
        });
      };
      for (const element of Array.from(proseMirror.children) as HTMLElement[]) collectPaginationElements(element);

      const geometry = { pageHeight, pageGap, marginTop, marginBottom };
      let plan = computeDocumentPagination(items, geometry);
      // Line geometry is expensive, so it is only measured for the blocks the
      // plan reports as reaching a page edge, and the plan is then redone.
      for (let round = 0; round < PAGINATION_MEASURE_ROUNDS && plan.measure.length; round += 1) {
        let measured = false;
        for (const index of plan.measure) {
          const element = elements[index];
          if (items[index].splits || !element) continue;
          try {
            items[index] = {
              ...items[index],
              splits: element.matches("table")
                ? measureTableRows(editor, element, natural)
                : measureTextLines(editor, element, natural),
            };
          } catch {
            items[index] = { ...items[index], splits: [] };
          }
          measured = true;
        }
        if (!measured) break;
        plan = computeDocumentPagination(items, geometry);
      }

      // Re-dispatching an unchanged set would rebuild every spacer widget for nothing.
      if (samePaginationBreaks(previousBreaks, plan.breaks)) {
        if (previousBreaks.length) setDocumentPaginationBreaks(editor, previousBreaks);
      } else {
        setDocumentPaginationBreaks(editor, plan.breaks);
      }
      setDocumentPageCount(plan.pageCount);
    };

    const schedule = (delay = 0) => {
      if (typingTimer) clearTimeout(typingTimer);
      cancelAnimationFrame(frame);
      if (!delay) {
        frame = requestAnimationFrame(paginate);
        return;
      }
      typingTimer = setTimeout(() => {
        typingTimer = null;
        frame = requestAnimationFrame(paginate);
      }, delay);
    };
    // Re-measuring every block on each keystroke forces a full reflow and makes
    // typing lag; the mapped spacers stay put until the burst settles.
    const scheduleAfterTyping = () => schedule(PAGINATION_TYPING_DELAY);
    const mediaResizeObserver = new ResizeObserver(() => schedule());
    for (const element of editor.view.dom.querySelectorAll("img, figure, table")) {
      mediaResizeObserver.observe(element);
    }
    const scheduleAfterMediaLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement) schedule();
    };
    const scheduleFromEvent = () => schedule();
    editor.view.dom.addEventListener("load", scheduleAfterMediaLoad, true);
    editor.view.dom.addEventListener("compositionend", scheduleAfterTyping);
    let disposed = false;
    void document.fonts?.ready.then(() => {
      if (!disposed) schedule();
    });
    editor.on("update", scheduleAfterTyping);
    window.addEventListener("resize", scheduleFromEvent);
    paginate();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (typingTimer) clearTimeout(typingTimer);
      mediaResizeObserver.disconnect();
      editor.view.dom.removeEventListener("load", scheduleAfterMediaLoad, true);
      editor.view.dom.removeEventListener("compositionend", scheduleAfterTyping);
      editor.off("update", scheduleAfterTyping);
      window.removeEventListener("resize", scheduleFromEvent);
      setDocumentPaginationBreaks(editor, []);
    };
  }, [documentMode, documentSettings.page, documentZoom, editor]);
  useEffect(() => { void pageVersion; }, [pageVersion]);
  useEffect(() => { if (commentFocusRequest > 0) commentRailRef.current?.focusGeneralComment(); }, [commentFocusRequest]);
  useEffect(() => {
    typewriterModeRef.current = typewriterMode;
    localStorage.setItem(preferencesKey, JSON.stringify({ statusVisible, minimalToolbar, typewriterMode }));
  }, [minimalToolbar, preferencesKey, statusVisible, typewriterMode]);
  useEffect(() => { window.localStorage.setItem(commentsPreferenceKey, String(commentsVisible)); }, [commentsPreferenceKey, commentsVisible]);
  useEffect(() => { window.localStorage.setItem(layoutPreferenceKey, String(documentLayoutVisible)); }, [documentLayoutVisible, layoutPreferenceKey]);
  useEffect(() => { window.localStorage.setItem(DOCUMENT_ZOOM_KEY, String(documentZoom)); }, [documentZoom]);
  // Figure/table numbers and cross-reference labels shown live in the canvas use the
  // document's own citation language, matching the word the PDF/DOCX export picks —
  // and caption numbering only shows where the export shows it (index enabled).
  useEffect(() => {
    if (!editor) return;
    const german = citationLocale.toLocaleLowerCase().startsWith("de");
    setDocumentNumberingConfig(editor, {
      figureLabel: german ? "Abbildung" : "Figure",
      tableLabel: german ? "Tabelle" : "Table",
      numberFigures: documentSettings.figures.enabled,
      numberTables: documentSettings.tables.enabled,
    });
  }, [citationLocale, documentSettings.figures.enabled, documentSettings.tables.enabled, editor]);
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    appliedZoom.current = documentZoom;
    zoomAnchor.current = null;
    const surface = editorRootRef.current?.querySelector<HTMLElement>(".wiki-editor-surface");
    if (!anchor || !surface) return;
    // Runs before paint, so the correction is part of the same frame as the zoom.
    const rect = surface.getBoundingClientRect();
    const scale = documentZoom / 100;
    keepZoomAnchorInPlace(
      surface,
      rect.left + anchor.contentX * scale - anchor.clientX,
      rect.top + anchor.contentY * scale - anchor.clientY,
    );
  }, [documentZoom]);
  useEffect(() => {
    const workspace = editorRootRef.current;
    if (!workspace) return;
    let controlPressed = false;

    const zoomEditor = (event: WheelEvent) => {
      const target = event.target;
      const activeElement = document.activeElement;
      const belongsToEditor = target instanceof globalThis.Node && workspace.contains(target);
      const editorFocused = activeElement instanceof globalThis.Node && workspace.contains(activeElement);
      if ((!event.ctrlKey && !event.metaKey && !controlPressed) || (!belongsToEditor && !editorFocused)) return;
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? 1 : -1;
      const intensity = Math.max(1, Math.min(4, Math.round(Math.abs(event.deltaY) / 25)));
      captureZoomAnchorRef.current(event.clientX, event.clientY);
      setDocumentZoom((value) => Math.min(DOCUMENT_ZOOM_MAX, Math.max(DOCUMENT_ZOOM_MIN, value + direction * intensity * 2)));
    };
    const trackControlKey = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") controlPressed = event.type === "keydown";
      if (event.type !== "keydown" || (!event.ctrlKey && !event.metaKey)) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        captureZoomAnchorRef.current(window.innerWidth / 2, window.innerHeight / 2);
        setDocumentZoom((value) => Math.min(DOCUMENT_ZOOM_MAX, value + 10));
      } else if (event.key === "-") {
        event.preventDefault();
        captureZoomAnchorRef.current(window.innerWidth / 2, window.innerHeight / 2);
        setDocumentZoom((value) => Math.max(DOCUMENT_ZOOM_MIN, value - 10));
      } else if (event.key === "0") {
        event.preventDefault();
        captureZoomAnchorRef.current(window.innerWidth / 2, window.innerHeight / 2);
        setDocumentZoom(100);
      }
    };
    const releaseControlKey = () => { controlPressed = false; };

    window.addEventListener("wheel", zoomEditor, { capture: true, passive: false });
    window.addEventListener("keydown", trackControlKey, true);
    window.addEventListener("keyup", trackControlKey, true);
    window.addEventListener("blur", releaseControlKey);
    return () => {
      window.removeEventListener("wheel", zoomEditor, true);
      window.removeEventListener("keydown", trackControlKey, true);
      window.removeEventListener("keyup", trackControlKey, true);
      window.removeEventListener("blur", releaseControlKey);
    };
  }, [editor]);
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
        case "search": changeSearchOpen(true); break;
        case "outline": setOutlineOpen(true); break;
        case "inlineComment": prepareComment(); break;
        case "toggleComments": setCommentsVisible((value) => !value); break;
        case "documentMode": changeDocumentMode(!documentMode); break;
        case "markdownHelp": setMarkdownHelpOpen(true); break;
        case "typography": setTypographyOpen(true); break;
        case "shortcuts": setShortcutsOpen(true); break;
        case "image": openInlineImagePicker(); break;
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

  const insertedEvidence = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    // The mode is read through a closure in the plugin, so updating the option is
    // enough — no extension teardown or editor rebuild.
    editor.extensionManager.extensions
      .filter((extension) => extension.name === "wikiSuggestionMode")
      .forEach((extension) => { extension.options.enabled = suggesting; extension.options.author = currentUserId; });
  }, [currentUserId, editor, suggesting]);

  useEffect(() => {
    if (!editor || !insertEvidenceId) return;
    // Inserting is a mutation, not a focus like the effects below, so it must happen
    // exactly once: the ref guards a re-render and the URL is stripped immediately so
    // a reload cannot repeat it.
    if (insertedEvidence.current === insertEvidenceId) return;
    insertedEvidence.current = insertEvidenceId;
    const url = new URL(window.location.href);
    url.searchParams.delete("insertEvidence");
    router.replace(url.pathname + url.search, { scroll: false });
    void (async () => {
      try {
        const response = await fetch(`/api/wiki/evidence?annotationId=${encodeURIComponent(insertEvidenceId)}`);
        if (!response.ok) throw new Error(t("evidenceInsertFailed"));
        const { annotation } = await response.json() as { annotation: EvidenceRef };
        editor.chain().focus("end").insertContent(evidenceInsertContent(annotation, citationLocale)).run();
        toast.success(t("evidenceInserted", { source: annotation.sourceTitle }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("evidenceInsertFailed"));
      }
    })();
  }, [citationLocale, editor, insertEvidenceId, router, t]);

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
  const handleSvgAssetReady = useCallback((attachmentId: string, contentUrl: string) => {
    if (!editor) return;
    const transaction = editor.state.tr;
    let changed = false;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "commentableImage" || node.attrs.attachmentId !== attachmentId || node.attrs.src === contentUrl) return;
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, src: contentUrl });
      changed = true;
    });
    if (changed) editor.view.dispatch(transaction);
  }, [editor]);
  // Lets the sidebar graphics section drop a graphic in at the cursor. The
  // editor owns the document, so it exposes the action rather than the reverse.
  useEffect(() => {
    if (!actionsRef || !editor) return;
    actionsRef.current = {
      insertGraphic: ({ attachmentId, fileName, contentUrl, caption }) => {
        // Insert *after* the selection rather than into it: a freshly inserted
        // graphic stays selected as a node, and inserting into that selection
        // would replace the graphic that was just dropped in.
        const at = editor.state.selection.to;
        editor.chain().insertContentAt(at, {
          type: "commentableImage",
          // The rendered URL, not /api/files, so document typography applies immediately.
          attrs: {
            ...imageNodeAttrs({ id: attachmentId, fileName, mimeType: "image/svg+xml" }),
            src: contentUrl,
            // The sidecar's ready-made Bildunterschrift wins over the filename.
            ...(caption ? { caption } : {}),
          },
        }).focus().run();
      },
    };
    return () => { actionsRef.current = null; };
  }, [actionsRef, editor]);
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
    localStorage.setItem(storageKey, JSON.stringify({
      contentJson: json,
      documentMode: documentModeRef.current,
      documentSettingsJson: serializeDocumentSettings(documentSettingsRef.current),
      baseContentVersion: contentVersion.current,
      editorSessionId: editorSessionId.current,
      savedAt: Date.now(),
    }));
    setSaveState(conflictBlocked.current ? "conflict" : "unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!conflictBlocked.current) saveTimer.current = setTimeout(persistLatestContent, 2_000);
    if (!maxSaveTimer.current) maxSaveTimer.current = setTimeout(() => {
      maxSaveTimer.current = null;
      persistLatestContent();
    }, 10_000);
  }
  function openInlineImagePicker() {
    rememberToolbarSelection();
    setInlineImagePickerOpen(true);
    setExistingImagesLoading(true);
    setExistingImagesError("");
    void fetch(`/api/files?entityType=wikiPage&entityId=${encodeURIComponent(pageId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(t("imagePicker.loadFailed"));
        return response.json() as Promise<ExistingImageAttachment[]>;
      })
      .then((attachments) => {
        setExistingImages(attachments.filter(isExistingInlineImage));
      })
      .catch((reason: unknown) => {
        setExistingImagesError(reason instanceof Error ? reason.message : t("imagePicker.loadFailed"));
      })
      .finally(() => setExistingImagesLoading(false));
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
  function resolveSuggestions(accept: boolean) {
    if (!editor) return;
    const resolved = (accept ? acceptSuggestions : rejectSuggestions)(editor.getJSON() as never);
    editor.commands.setContent(resolved as never, { emitUpdate: true });
    setSuggestionCounts({ inserted: 0, deleted: 0 });
  }

  const layoutVisible = documentMode && documentLayoutVisible;
  const figureIndexVisible = documentMode && documentSettings.figures.enabled && figureCaptions.length > 0;
  const tableIndexVisible = documentMode && documentSettings.tables.enabled && tableCaptions.length > 0;
  const bibliography = formatBibliography(
    citedSourceIds.flatMap((sourceId) => {
      const source = sources.find((candidate) => candidate.id === sourceId);
      return source ? [source] : [];
    }),
    citationLocale,
    citationStyle,
  );
  const bibliographyVisible = documentMode && documentSettings.bibliography.enabled && bibliography.length > 0;
  function bibliographyHref(source: SourceRef) {
    const target = citationTargets.find((item) => item.sourceId === source.id);
    const documentId = target?.documentId || source.pdfDocumentId;
    if (!documentId) return `/wiki/sources/${source.id}`;
    const query = new URLSearchParams();
    if (target?.locator && /^\d+$/.test(target.locator)) query.set("page", target.locator);
    if (target?.annotationId) query.set("annotation", target.annotationId);
    const suffix = query.size ? `?${query.toString()}` : "";
    return `/wiki/sources/${source.id}/read/${documentId}${suffix}`;
  }
  const paperWidth = documentSettings.page.size === "A4" ? 210 : 215.9;
  const paperHeight = documentSettings.page.size === "A4" ? 297 : 279.4;
  const orientedPaperHeight = documentSettings.page.orientation === "portrait" ? paperHeight : paperWidth;
  const coverPageCount = documentSettings.cover.enabled ? 1 : 0;
  const bibliographyPageCount = bibliographyVisible ? 1 : 0;
  const figurePageCount = figureIndexVisible ? 1 : 0;
  const visibleDocumentPages = coverPageCount + documentPageCount + bibliographyPageCount + figurePageCount;
  const pageStackPosition = (index: number) => index * (orientedPaperHeight + 12);
  const resolveDocumentText = (value: string) => value.replace(/\{([^}]+)\}/g, (_, key: string) => key === "title" ? pageTitle : documentSettings.variables[key] ?? `{${key}}`);
  const documentCanvasStyle = {
    ...wikiTypographyCssVariables(typography),
    "--document-paper-width": `${documentSettings.page.orientation === "portrait" ? paperWidth : paperHeight}mm`,
    "--document-paper-height": `${documentSettings.page.orientation === "portrait" ? paperHeight : paperWidth}mm`,
    "--document-margin-top": `${documentSettings.page.marginsMm.top}mm`,
    "--document-margin-right": `${documentSettings.page.marginsMm.right}mm`,
    "--document-margin-bottom": `${documentSettings.page.marginsMm.bottom}mm`,
    "--document-margin-left": `${documentSettings.page.marginsMm.left}mm`,
    "--document-page-gap": "12mm",
    "--document-content-pages": String(documentPageCount),
    "--document-page-count": String(visibleDocumentPages),
    "--document-content-stack-height": `${documentPageCount * (documentSettings.page.orientation === "portrait" ? paperHeight : paperWidth) + Math.max(0, documentPageCount - 1) * 12}mm`,
    "--document-content-offset": `${coverPageCount ? orientedPaperHeight + 12 : 0}mm`,
    "--document-bibliography-top": `${pageStackPosition(coverPageCount + documentPageCount)}mm`,
    "--document-figure-index-top": `${pageStackPosition(coverPageCount + documentPageCount + bibliographyPageCount)}mm`,
    "--document-table-index-top": pageStackPosition(coverPageCount + documentPageCount + bibliographyPageCount + figurePageCount) + "mm",
    "--document-stack-height": `${visibleDocumentPages * orientedPaperHeight + Math.max(0, visibleDocumentPages - 1) * 12}mm`,
    zoom: documentZoom / 100,
  } as CSSProperties;
  const editorTypographyStyle = {
    ...wikiTypographyCssVariables(typography),
    zoom: documentZoom / 100,
  } as CSSProperties;
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
  function openImageDescription() {
    const current = activeEditor.state.selection;
    if (!(current instanceof NodeSelection) || current.node.type.name !== "commentableImage") return;
    setImageCaptionDraft(String(current.node.attrs.caption ?? ""));
    setImageAltDraft(String(current.node.attrs.alt ?? ""));
    setImageInFigureIndexDraft(current.node.attrs.includeInFigureIndex !== false);
    setImageDescriptionOpen(true);
  }
  function saveImageDescription() {
    activeEditor.chain().focus().updateAttributes("commentableImage", {
      caption: imageCaptionDraft.trim(),
      alt: imageAltDraft.trim(),
      includeInFigureIndex: imageInFigureIndexDraft,
    }).run();
    setImageDescriptionOpen(false);
  }
  async function insertInlineImage(file: File) {
    if (!isInlineImageFile(file)) { setImageError(t("inlineImageUnsupported")); return; }
    file = normalizeInlineImageFile(file);
    setImageUploading(true); setImageError("");
    try {
      const attachment = await uploadInlineAttachment(pageId, file);
      insertImageWithCaption(attachment);
      router.refresh();
    } catch (error) {
      setImageError(error instanceof Error ? error.message : t("uploadFailed"));
    } finally {
      setImageUploading(false);
    }
  }
  /**
   * Selects a just-inserted image so the caption dialog, which acts on the current
   * NodeSelection, targets it.
   */
  function selectImageNode(nodeId: string) {
    let position = -1;
    activeEditor.state.doc.descendants((node, pos) => {
      if (position >= 0) return false;
      if (node.type.name === "commentableImage" && node.attrs.nodeId === nodeId) position = pos;
      return undefined;
    });
    if (position < 0) return false;
    activeEditor.chain().focus().setNodeSelection(position).run();
    return true;
  }

  /**
   * Inserts an image and asks for its caption straight away. The caption otherwise
   * defaults to the file name, which is almost never what belongs under a figure.
   */
  function insertImageWithCaption(attachment: UploadedAttachment) {
    const attrs = imageNodeAttrs(attachment);
    toolbarChain().insertContent({ type: "commentableImage", attrs }).run();
    setInlineImagePickerOpen(false);
    if (selectImageNode(String(attrs.nodeId))) openImageDescription();
  }

  function insertExistingImage(attachment: ExistingImageAttachment) {
    insertImageWithCaption(attachment);
  }
  async function submitComment() {
    if (!pendingAnchor || !commentBody.trim()) return;
    const result = await addComment({ pageId, body: commentBody, anchor: pendingAnchor, assigneeId: assigneeId === "none" ? null : assigneeId });
    if (pendingAnchor.type === "text" && selection.current) addThreadMark(activeEditor, selection.current, result.threadId);
    setOptimisticCommentThreads((current) => [result.thread, ...current.filter((thread) => thread.id !== result.threadId)]);
    setActiveThreadId(result.threadId);
    setCommentsVisible(true);
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

  async function cycleProofingLanguage() {
    const previous = proofingLanguage;
    const next = nextProofingLanguage(previous);
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

  async function toggleProofingPicky() {
    const previous = proofingPicky;
    const next = !previous;
    setProofingPicky(next);
    try {
      await updateMyWikiProofingPicky(next);
    } catch {
      setProofingPicky(previous);
      toast.error(t("editor.proofing.saveFailed"));
    }
  }

  function ignoreCurrentProofingIssue() {
    if (!spellcheckIssue) return;
    const key = proofingIssueKey(spellcheckIssue.issue);
    ignoredProofingIssues.current.add(key);
    setSpellcheckIssues(activeEditor, getSpellcheckIssues(activeEditor).filter((issue) => proofingIssueKey(issue) !== key));
    setSpellcheckIssue(null);
    void ignoreMyWikiProofingIssue(key).catch(() => {});
  }

  function disableCurrentProofingRule() {
    if (!spellcheckIssue?.issue.ruleId) return;
    const { ruleId } = spellcheckIssue.issue;
    disabledProofingRuleIds.current.add(ruleId);
    setSpellcheckIssues(activeEditor, getSpellcheckIssues(activeEditor).filter((issue) => issue.ruleId !== ruleId));
    setSpellcheckIssue(null);
    void disableMyWikiProofingRule(ruleId).catch(() => {});
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
    const retainedIssues = getSpellcheckIssues(activeEditor).filter((issue) => {
      const text = activeEditor.state.doc.textBetween(issue.from, issue.to);
      return text !== source;
    });
    setSpellcheckIssues(activeEditor, retainedIssues);
    const count = replaceAllSpellcheckOccurrences(activeEditor, source, replacement);
    setSpellcheckIssue(null);
    if (count > 0) toast.success(t("editor.proofing.replacedAll", { count }));
  }

  function replaceCurrentProofingIssue(replacement: string) {
    if (!spellcheckIssue) return;
    const { issue } = spellcheckIssue;
    const source = activeEditor.state.doc.textBetween(issue.from, issue.to);
    if (!source || source === replacement) return;
    setSpellcheckIssues(activeEditor, getSpellcheckIssues(activeEditor).filter((candidate) => proofingIssueKey(candidate) !== proofingIssueKey(issue)));
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
  const shortcutLabel = (action: WikiShortcutAction) => displayShortcut(wikiShortcuts[action], { ctrl: t("shortcuts.keys.ctrl"), delete: t("shortcuts.keys.delete") });
  const proofingLanguageNames: Record<ProofingLanguage, string> = { "de-DE": t("editor.proofing.languages.de"), "de-AT": t("editor.proofing.languages.deAt"), "en-US": t("editor.proofing.languages.en") };
  const proofingLanguageAbbreviations: Record<ProofingLanguage, string> = { "de-DE": "DE", "de-AT": "AT", "en-US": "EN" };
  const proofingLanguageLabel = proofingLanguageNames[proofingLanguage];
  const nextProofingLanguageLabel = proofingLanguageNames[nextProofingLanguage(proofingLanguage)];
  const proofingButtonTitle = proofingStatus === "error"
    ? t("editor.proofing.browserFallback")
    : t("editor.proofing.switch", { language: proofingLanguageLabel, nextLanguage: nextProofingLanguageLabel });
  const unresolvedCommentCount = commentThreads.filter((thread) => !thread.resolvedAt).length;
  const currentDocumentModeLabel = t(documentMode ? "document.documentMode" : "document.noteMode");
  const nextDocumentModeLabel = t(documentMode ? "document.noteMode" : "document.documentMode");

  return <div className="relative flex flex-col gap-3"><div className="sticky top-0 z-40 flex flex-wrap items-center gap-1.5 rounded-xl border bg-background/95 p-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
    <ToolbarGroup label={t("editor.toolbar.groups.history")}>
      <ToolbarButton title={t("editor.toolbar.undo")} shortcut={shortcutLabel("undo")} onClick={() => activeEditor.chain().focus().undo().run()}><Undo2 className="size-4" /></ToolbarButton>
      <ToolbarButton title={t("editor.toolbar.redo")} shortcut={shortcutLabel("redo")} onClick={() => activeEditor.chain().focus().redo().run()}><Redo2 className="size-4" /></ToolbarButton>
    </ToolbarGroup>
    <ToolbarGroup label={t("editor.toolbar.groups.writing")}>
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
    </ToolbarGroup>
    <ToolbarGroup label={t("editor.toolbar.groups.insert")}>
      <EditorLinkPopover editor={activeEditor} pages={allPages} request={linkEditorRequest} />
      <PageLinkPicker editor={editor} pages={allPages} open={pageLinkOpen} onOpenChange={setPageLinkOpen} /><CitationPicker editor={editor} sources={sources} locale={citationLocale} pageSlug={pageSlug} open={citationOpen} onOpenChange={setCitationOpen} /><EvidencePicker editor={editor} pageId={pageId} locale={citationLocale} open={evidenceOpen} onOpenChange={setEvidenceOpen} />
      <ToolbarMenu label={t("editor.toolbar.insert")} icon={<ImagePlus className="size-4" />} onPointerDown={rememberToolbarSelection}>
      <DropdownMenuItem onClick={openInlineImagePicker}><ImagePlus />{t("insertImage")}<DropdownMenuShortcut>{shortcutLabel("image")}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onClick={() => toolbarChain().setHorizontalRule().run()}><Minus />{t("slash.commands.horizontalRule.label")}<DropdownMenuShortcut>{shortcutLabel("horizontalRule")}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onClick={() => pageActions.addAttachment()}><Paperclip />{t("slash.commands.attachment.label")}<DropdownMenuShortcut>{shortcutLabel("attachment")}</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onClick={() => pageActions.linkSupportingSource()}><BookMarked />{t("slash.commands.supportingSource.label")}<DropdownMenuShortcut>{shortcutLabel("supportingSource")}</DropdownMenuShortcut></DropdownMenuItem>
      </ToolbarMenu>
    </ToolbarGroup>
    <input ref={imageInputRef} data-testid="wiki-inline-image-input" hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertInlineImage(file); event.target.value = ""; }} />
    <Dialog open={inlineImagePickerOpen} onOpenChange={setInlineImagePickerOpen}>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{t("imagePicker.title")}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{t("imagePicker.description")}</p>
        {existingImagesLoading ? <div className="grid min-h-44 place-items-center"><RotateCcw className="size-5 animate-spin text-muted-foreground" /></div>
          : existingImagesError ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{existingImagesError}</p>
          : existingImages.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{existingImages.map((attachment) => <button key={attachment.id} type="button" data-testid={`wiki-existing-image-${attachment.id}`} onClick={() => insertExistingImage(attachment)} className="group overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-indigo-950/20">
            {/* Existing graphics are user-uploaded files and cannot use the Next image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${attachment.id}`} alt="" className="aspect-[4/3] w-full bg-muted object-contain" />
            <span className="block truncate px-2.5 py-2 text-xs font-medium">{attachment.fileName}</span>
          </button>)}</div>
            : <div className="rounded-lg border border-dashed p-6 text-center"><ImagePlus className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-sm font-medium">{t("imagePicker.empty")}</p><p className="mt-1 text-xs text-muted-foreground">{t("imagePicker.emptyHint")}</p></div>}
        <div className="flex justify-end border-t pt-3"><Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => imageInputRef.current?.click()}><ImagePlus className="size-4" />{t("imagePicker.addFromPath")}</Button></div>
      </DialogContent>
    </Dialog>
    <ToolbarMenu label={t("editor.toolbar.more")} icon={<MoreHorizontal className="size-4" />}>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("editor.toolbar.groups.review")}</DropdownMenuLabel>
        <DropdownMenuItem className="xl:hidden" title={proofingButtonTitle} disabled={proofingSaving} onClick={() => void cycleProofingLanguage()}><Languages />{proofingLanguageLabel}<span className="ml-auto text-xs text-muted-foreground">{proofingLanguageAbbreviations[proofingLanguage]} → {proofingLanguageAbbreviations[nextProofingLanguage(proofingLanguage)]}</span></DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={proofingPicky} onCheckedChange={() => void toggleProofingPicky()}><Settings2 />{t("editor.proofing.picky")}</DropdownMenuCheckboxItem>
        <DropdownMenuItem onClick={() => setSuggesting((value) => !value)}><ScissorsLineDashed />{suggesting ? t("suggestions.leaveMode") : t("suggestions.enterMode")}</DropdownMenuItem>
        {(suggestionCounts.inserted > 0 || suggestionCounts.deleted > 0) && <>
          <DropdownMenuItem onClick={() => resolveSuggestions(true)}><Check />{t("suggestions.acceptAll", { count: suggestionCounts.inserted + suggestionCounts.deleted })}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => resolveSuggestions(false)}><RotateCcw />{t("suggestions.rejectAll")}</DropdownMenuItem>
        </>}
        <DropdownMenuItem onClick={() => changeSearchOpen(!searchOpen)}><Search />{t("editor.search.title")}</DropdownMenuItem>
        <DropdownMenuItem className="xl:hidden" onClick={() => setOutlineOpen(true)}><ListTree />{t("editor.outline.title")}</DropdownMenuItem>
        <DropdownMenuItem onClick={prepareComment}><MessageSquareText />{t("inlineComment")}</DropdownMenuItem>
        <DropdownMenuItem className="xl:hidden" onClick={() => setCommentsVisible((value) => !value)}><MessageSquareText />{commentsVisible ? t("hideComments") : t("showComments")}</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("editor.toolbar.groups.document")}</DropdownMenuLabel>
        <DropdownMenuItem className="xl:hidden" onClick={() => changeDocumentMode(!documentMode)}><FileText />{currentDocumentModeLabel} → {nextDocumentModeLabel}</DropdownMenuItem>
        {documentMode && <DropdownMenuItem onClick={() => setDocumentLayoutVisible((value) => !value)}>{layoutVisible ? <PanelRightClose /> : <PanelRightOpen />}{layoutVisible ? t("document.hideLayout") : t("document.showLayout")}</DropdownMenuItem>}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("editor.toolbar.actions")}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => requestWikiTask(activeEditor)}><ClipboardCheck />{tTasks("createTask")}<DropdownMenuShortcut>{tTasks("globalShortcut")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => requestWikiDeadline(activeEditor)}><CalendarClock />{tDeadlines("createDeadline")}<DropdownMenuShortcut>{tDeadlines("globalShortcut")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => setGraphicsOpen(true)}><Layers3 />{t("graphics.title")}</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("editor.toolbar.settings")}</DropdownMenuLabel>
        <DropdownMenuItem data-testid="markdown-help-button" onClick={() => setMarkdownHelpOpen(true)}><BookMarked />{t("markdownHelp.button")}<DropdownMenuShortcut>{shortcutLabel("markdownHelp")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTypographyOpen(true)}><Settings2 />{t("editor.preferences.title")}<DropdownMenuShortcut>{shortcutLabel("typography")}</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShortcutsOpen(true)}><Keyboard />{t("shortcuts.title")}<DropdownMenuShortcut>{shortcutLabel("shortcuts")}</DropdownMenuShortcut></DropdownMenuItem>
      </DropdownMenuGroup>
    </ToolbarMenu>
    <span role={saveState === "error" || saveState === "conflict" ? "alert" : "status"} aria-live={saveState === "error" || saveState === "conflict" ? "assertive" : "polite"} className={`ml-auto flex items-center gap-1 px-2 text-xs ${savePresentation.className}`}>{savePresentation.icon}{savePresentation.label}</span>
    {(saveState === "error" || saveState === "offline") && pendingSave.current && <Button type="button" size="xs" variant="ghost" onClick={() => void persistContent(pendingSave.current!)}>{t("editor.save.retry")}</Button>}
  </div>
  <EditorSearchPanel key={externalSearchQuery} editor={activeEditor} open={searchOpen} onOpenChange={changeSearchOpen} initialQuery={externalSearchQuery} />
  {imageUploading && <p className="text-xs text-muted-foreground">{t("uploadingImage")}</p>}
  {imageError && <p className="text-xs text-destructive">{imageError}</p>}
  {leaseState === "locked" && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 text-sm text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-100"><CloudOff className="size-4" /><span className="flex-1">{t("editor.lease.locked")}</span><Button size="sm" onClick={() => void takeOverEditing()}>{t("editor.lease.takeover")}</Button></div>}
  {saveState === "conflict" && conflictRevision && <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><RotateCcw className="size-4" /><span className="flex-1">{t("editConflictDescription")}</span><Button size="sm" variant="outline" onClick={discardDraftAndReload}>{t("loadCurrent")}</Button><Button size="sm" onClick={() => void restoreConflictDraft()}>{t("restoreMine")}</Button></div>}
  <div className={
    documentMode
      ? commentsVisible && layoutVisible
        ? "grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_8rem_18rem_18rem]"
        : commentsVisible || layoutVisible
          ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_8rem_18rem]"
          : "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_8rem]"
      : commentsVisible
        ? focused
          ? "grid items-start justify-center gap-4 xl:grid-cols-[minmax(0,56rem)_8rem_18rem]"
          : "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_8rem_18rem]"
        : focused
          ? "grid items-start justify-center gap-4 xl:grid-cols-[minmax(0,56rem)_8rem]"
          : "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_8rem]"
  }>
    <div
      ref={editorRootRef}
      className={documentMode ? "wiki-document-workspace relative min-w-0" : "relative min-w-0 overflow-x-auto"}
      onKeyDownCapture={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLocaleLowerCase() === "a") {
          event.preventDefault();
          event.stopPropagation();
          requestWikiTask(activeEditor);
        }
      }}
    >
      <BubbleMenu editor={editor} pluginKey="wikiTextCommentMenu" options={{ strategy: "fixed", flip: true, shift: true, offset: 8 }} shouldShow={({ state }) => !state.selection.empty && !(state.selection instanceof NodeSelection)} className="z-40 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
        <Button type="button" size="icon-sm" variant={activeEditor.isActive("bold") ? "secondary" : "ghost"} aria-label={t("editor.toolbar.bold")} onClick={() => activeEditor.chain().focus().toggleBold().run()}><Bold className="size-4" /></Button>
        <Button type="button" size="icon-sm" variant={activeEditor.isActive("italic") ? "secondary" : "ghost"} aria-label={t("editor.toolbar.italic")} onClick={() => activeEditor.chain().focus().toggleItalic().run()}><Italic className="size-4" /></Button>
        <Button type="button" size="icon-sm" variant={activeEditor.isActive("link") ? "secondary" : "ghost"} aria-label={t("editor.link.button")} onClick={() => setLinkEditorRequest((value) => value + 1)}><Link2 className="size-4" /></Button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Button type="button" size="sm" variant={activeEditor.isActive("highlight") ? "secondary" : "ghost"} onClick={() => activeEditor.chain().focus().toggleMark("highlight", { createdBy: currentUserId }).run()}><Highlighter className="size-4" />{t("highlightSelection")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={prepareComment}><MessageSquareText className="size-4" />{t("commentSelection")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => requestWikiTask(activeEditor)}><ClipboardCheck className="size-4" />{tTasks("createTask")}</Button>
      </BubbleMenu>
      <BubbleMenu editor={editor} pluginKey="wikiImageCommentMenu" options={{ strategy: "fixed", placement: "bottom", flip: true, shift: true, offset: 8 }} shouldShow={({ state }) => state.selection instanceof NodeSelection && ["commentableImage", "pdfEvidence"].includes(state.selection.node.type.name)} className="z-40 flex items-center gap-1 rounded-lg border bg-background p-1 shadow-lg">
        <Button type="button" size="sm" variant="ghost" onClick={() => prepareImageComment("whole")}><MessageSquareText className="size-4" />{t("commentWholeImage")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => prepareImageComment("region")}><Scan className="size-4" />{t("selectImageRegion")}</Button>
        {activeEditor.isActive("commentableImage") && <>
          <Button type="button" size="sm" variant="ghost" onClick={openImageDescription}><Captions className="size-4" />{t("imageDescription.button")}</Button>
        </>}
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
        data-margin-guides={documentSettings.page.showMarginGuides ? "true" : "false"}
        data-numbered-headings={documentMode && documentSettings.page.numberedHeadings ? "true" : "false"}
        style={documentMode ? documentCanvasStyle : editorTypographyStyle}
      >
        {documentMode && Array.from({ length: visibleDocumentPages }, (_, index) => <div key={index} className="wiki-document-page-sheet" style={{ top: `calc(${index} * (var(--document-paper-height) + var(--document-page-gap)))` }} aria-hidden="true" />)}
        {documentMode && documentSettings.cover.enabled && <section className="wiki-document-cover" aria-label={t("document.cover")}>
          <p>{documentSettings.cover.eyebrow}</p>
          <h1>{pageTitle}</h1>
          {documentSettings.cover.subtitle && <h2>{resolveDocumentText(documentSettings.cover.subtitle)}</h2>}
          <dl>
            {(documentSettings.cover.author || documentSettings.metadata.author) && <div><dt>{t("document.author")}</dt><dd>{resolveDocumentText(documentSettings.cover.author || documentSettings.metadata.author)}</dd></div>}
            {documentSettings.cover.organization && <div><dt>{t("document.organization")}</dt><dd>{resolveDocumentText(documentSettings.cover.organization)}</dd></div>}
            {(documentSettings.cover.date || documentSettings.variables.date) && <div><dt>{t("document.date")}</dt><dd>{resolveDocumentText(documentSettings.cover.date || documentSettings.variables.date)}</dd></div>}
          </dl>
        </section>}
        {documentMode && Array.from({ length: documentPageCount }, (_, index) => {
          const pageNumber = documentSettings.footer.pageNumberStart + index;
          const top = pageStackPosition(coverPageCount + index);
          return <div key={`chrome-${index}`} className="wiki-document-page-chrome" style={{ top: `${top}mm` }} aria-hidden="true">
            {documentSettings.header.enabled && <header><span>{resolveDocumentText(documentSettings.header.left)}</span><span>{resolveDocumentText(documentSettings.header.center)}</span><span>{resolveDocumentText(documentSettings.header.right)}</span></header>}
            {documentSettings.footer.enabled && <footer><span>{resolveDocumentText(documentSettings.footer.left)}</span><span>{resolveDocumentText(documentSettings.footer.center)}</span><span>{resolveDocumentText(documentSettings.footer.right)}</span>{documentSettings.footer.pageNumbers && <b>{pageNumber}</b>}</footer>}
          </div>;
        })}
        <EditorContent editor={editor} data-testid="wiki-editor" data-document-mode={documentMode ? "true" : "false"} />
        {bibliographyVisible && <section className="wiki-document-bibliography" aria-label={documentSettings.bibliography.heading}>
          <p className="wiki-document-figure-index-kicker">IEEE</p>
          <h2>{documentSettings.bibliography.heading || t("references")}</h2>
          <ol>{bibliography.map(({ source, text }) => <li key={source.id}><a href={bibliographyHref(source)}>{text}</a></li>)}</ol>
        </section>}
        {figureIndexVisible && <section className="wiki-document-figure-index" aria-label={documentSettings.figures.heading}>
          <p className="wiki-document-figure-index-kicker">{t("document.figureIndex")}</p>
          <h2>{documentSettings.figures.heading}</h2>
          {/* A caption that already numbers itself ("Abbildung 4: …") is not numbered twice. */}
          <ol>{figureCaptions.map((figure, index) => <li key={figure.nodeId}><span>{hasOwnFigureNumber(figure.caption) ? "" : t("document.figureNumber", { number: index + 1 })}</span><span>{figure.caption}</span></li>)}</ol>
        </section>}
        {tableIndexVisible && <section className="wiki-document-figure-index wiki-document-table-index" style={{ top: "var(--document-table-index-top)" }} aria-label={documentSettings.tables.heading}>
          <p className="wiki-document-figure-index-kicker">{t("document.tableIndex")}</p>
          <h2>{documentSettings.tables.heading}</h2>
          <ol>{tableCaptions.map((table, index) => <li key={table.tableId}><span>{t("document.tableNumber", { number: index + 1 })}</span><span>{table.caption}</span></li>)}</ol>
        </section>}
      </div>
      {spellcheckIssue && <div role="dialog" aria-label={t("editor.proofing.dialog")} className="fixed z-50 max-h-[min(28rem,calc(100vh-2rem))] w-72 overflow-y-auto rounded-lg border bg-popover p-2 shadow-lg" style={{ left: Math.min(spellcheckIssue.rect.left, window.innerWidth - 304), top: Math.min(spellcheckIssue.rect.bottom + 8, window.innerHeight - 210) }}>
        <p className="px-2 pb-1 text-xs font-medium">{t(spellcheckIssue.issue.kind === "spelling" ? "editor.proofing.types.spelling" : "editor.proofing.types.writing")}{spellcheckIssue.issue.category && <span className="font-normal text-muted-foreground"> · {spellcheckIssue.issue.category}</span>}</p>
        <p className="px-2 pb-1 break-words font-mono text-xs">{activeEditor.state.doc.textBetween(spellcheckIssue.issue.from, spellcheckIssue.issue.to)}</p>
        <p className="px-2 pb-1 text-xs text-muted-foreground">{spellcheckIssue.issue.message}</p>
        {spellcheckIssue.issue.replacements.length ? spellcheckIssue.issue.replacements.map((replacement) => <Button key={replacement} type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => replaceCurrentProofingIssue(replacement)}>{replacement}</Button>) : <p className="px-2 py-1 text-xs text-muted-foreground">{t("editor.proofing.noReplacement")}</p>}
        <div className="mt-1 border-t pt-1">
          {spellcheckIssue.issue.replacements[0] && <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => replaceAllCurrentProofingIssue(spellcheckIssue.issue.replacements[0])}>{t("editor.proofing.replaceAll")}</Button>}
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={ignoreCurrentProofingIssue}>{t("editor.proofing.ignore")}</Button>
          {spellcheckIssue.issue.kind === "spelling" && <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => void addCurrentWordToDictionary()}>{t("editor.proofing.addToDictionary")}</Button>}
          {spellcheckIssue.issue.ruleId && <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={disableCurrentProofingRule}>{t("editor.proofing.disableRule")}</Button>}
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setSpellcheckIssue(null)}>{t("editor.proofing.close")}</Button>
        </div>
      </div>}
      <CommentAnchorOverlay visible={commentsVisible} comments={commentThreads} editor={editor} rootRef={editorRootRef} activeThreadId={activeThreadId} onActiveThreadChange={setActiveThreadId} />
    </div>
    <aside data-testid="editor-side-tools" aria-label={t("editor.toolbar.sideTools")} className="sticky top-16 hidden w-32 flex-col gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur xl:flex">
      <Button type="button" data-testid="proofing-language-toggle" variant="outline" className="h-auto w-full flex-col items-stretch gap-1.5 px-2 py-2" aria-label={proofingButtonTitle} disabled={proofingSaving} onClick={() => void cycleProofingLanguage()}>
        <span className="flex items-center gap-1.5 text-xs font-medium"><Languages className="size-4" />{t("editor.toolbar.language")}</span>
        <span className="flex items-center justify-center gap-1 text-[10px]">{PROOFING_LANGUAGES.map((language, index) => <span key={language} className="flex items-center gap-1">{index > 0 && <ArrowLeftRight className="size-3 text-muted-foreground" />}<span className={proofingLanguage === language ? "font-semibold text-foreground" : "text-muted-foreground"}>{proofingLanguageAbbreviations[language]}</span></span>)}</span>
      </Button>
      <Button type="button" variant={outlineOpen ? "secondary" : "outline"} className="h-auto w-full justify-start gap-2 px-2 py-2 text-xs" aria-label={t("editor.outline.title")} aria-pressed={outlineOpen} onClick={() => setOutlineOpen(true)}><ListTree className="size-4" />{t("editor.toolbar.outline")}</Button>
      <Button type="button" variant={commentsVisible ? "secondary" : "outline"} className="h-auto w-full justify-start gap-2 px-2 py-2 text-xs" aria-label={commentsVisible ? t("hideComments") : t("showComments")} aria-pressed={commentsVisible} onClick={() => setCommentsVisible((value) => !value)}><MessageSquareText className="size-4" /><span className="min-w-0 flex-1 truncate text-left">{t("comments")}</span>{unresolvedCommentCount > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] tabular-nums">{unresolvedCommentCount}</span>}</Button>
      <Button type="button" data-testid="document-mode-toggle" variant="outline" className="h-auto w-full flex-col items-stretch gap-1.5 px-2 py-2" aria-label={t("document.switchMode", { current: currentDocumentModeLabel, next: nextDocumentModeLabel })} aria-pressed={documentMode} onClick={() => changeDocumentMode(!documentMode)}>
        <span className="flex items-center gap-1.5 text-xs font-medium"><FileText className="size-4" />{t("editor.toolbar.view")}</span>
        <span className="flex items-center justify-center gap-1 text-[10px]"><span className={!documentMode ? "font-semibold text-foreground" : "text-muted-foreground"}>{t("document.noteMode")}</span><ArrowLeftRight className="size-3 text-muted-foreground" /><span className={documentMode ? "font-semibold text-foreground" : "text-muted-foreground"}>{t("document.documentMode")}</span></span>
      </Button>
    </aside>
    <CommentRail ref={commentRailRef} visible={commentsVisible} onVisibleChange={setCommentsVisible} pageId={pageId} comments={commentThreads} currentUserId={currentUserId} editor={editor} editorRootRef={editorRootRef} activeThreadId={activeThreadId} onActiveThreadChange={setActiveThreadId} />
    {layoutVisible && <DocumentLayoutPanel
      pageId={pageId}
      editor={activeEditor}
      settings={documentSettings}
      onSettingsChange={changeDocumentSettings}
      templates={documentTemplates}
      issues={documentIssues}
      outline={outline}
      figureCount={figureCaptions.length}
      tableCount={tableCaptions.length}
      proposalData={proposalData}
      onOpenTypographySettings={() => setTypographyOpen(true)}
      onClose={() => setDocumentLayoutVisible(false)}
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
  <SvgGraphicsPanel pageId={pageId} open={graphicsOpen} onOpenChange={setGraphicsOpen} variables={{ title: pageTitle, author: documentSettings.metadata.author, ...documentSettings.variables }} documentSettings={documentSettings} typography={typography} onDocumentSettingsChange={changeDocumentSettings} onAssetReady={handleSvgAssetReady} />
  <Dialog open={imageDescriptionOpen} onOpenChange={setImageDescriptionOpen}><DialogContent className="w-[min(28rem,calc(100vw-2rem))]"><DialogHeader><DialogTitle>{t("imageDescription.title")}</DialogTitle></DialogHeader>
    <div className="grid gap-4">
      <label className="grid gap-1.5 text-sm font-medium">{t("imageDescription.caption")}<Input value={imageCaptionDraft} onChange={(event) => setImageCaptionDraft(event.target.value)} placeholder={t("imageDescription.captionPlaceholder")} /></label>
      <label className="grid gap-1.5 text-sm font-medium">{t("imageDescription.alt")}<Textarea value={imageAltDraft} onChange={(event) => setImageAltDraft(event.target.value)} placeholder={t("imageDescription.altPlaceholder")} /></label>
      <label className="flex items-start gap-2 rounded-lg border bg-muted/35 p-3 text-sm"><input className="mt-0.5 size-4 accent-indigo-600" type="checkbox" checked={imageInFigureIndexDraft} onChange={(event) => setImageInFigureIndexDraft(event.target.checked)} /><span><strong className="block font-medium">{t("imageDescription.include")}</strong><span className="text-xs text-muted-foreground">{t("imageDescription.includeHint")}</span></span></label>
      <Button type="button" onClick={saveImageDescription}>{t("imageDescription.save")}</Button>
    </div>
  </DialogContent></Dialog>
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
