import { defaultBlockAt } from "@tiptap/core";
import { isAllowedUri } from "@tiptap/extension-link";
import { Selection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import { closeHistory } from "@tiptap/pm/history";

export type MarkdownShortcutBoundary = "space" | "enter";
export type MarkdownShortcutMark =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "highlight"
  | "subscript"
  | "superscript";

type MarkMatch = {
  kind: "mark";
  raw: string;
  text: string;
  mark: MarkdownShortcutMark;
  attributes?: Record<string, unknown>;
  openingLength: number;
  tailLength: number;
};

type TextMatch = {
  kind: "text";
  raw: string;
  replacement: string;
  tailLength: number;
};

type NodeMatch = {
  kind: "node";
  raw: string;
  node: "footnoteReference";
  attributes: Record<string, unknown>;
  tailLength: number;
};

export type MarkdownShortcutMatch = MarkMatch | TextMatch | NodeMatch;

const emojiShortcodes: Record<string, string> = {
  joy: "😂",
  smile: "😄",
  grin: "😁",
  wink: "😉",
  heart: "❤️",
  broken_heart: "💔",
  thumbsup: "👍",
  thumbsdown: "👎",
  clap: "👏",
  pray: "🙏",
  tada: "🎉",
  fire: "🔥",
  rocket: "🚀",
  eyes: "👀",
  thinking: "🤔",
  sob: "😭",
  angry: "😠",
  white_check_mark: "✅",
  warning: "⚠️",
  x: "❌",
};

function markMatch(
  input: string,
  expression: RegExp,
  mark: MarkdownShortcutMark,
  openingLength: number,
  attributes?: (match: RegExpMatchArray) => Record<string, unknown> | null,
): MarkMatch | null {
  const match = input.match(expression);
  if (!match?.[1] || !match[2]) return null;
  const resolvedAttributes = attributes?.(match);
  if (attributes && !resolvedAttributes) return null;
  return {
    kind: "mark",
    raw: match[1],
    text: match[2],
    mark,
    attributes: resolvedAttributes ?? undefined,
    openingLength,
    tailLength: 0,
  };
}

export function matchMarkdownShortcut(textBeforeCursor: string): MarkdownShortcutMatch | null {
  const standardMarks: Array<MarkMatch | null> = [
    markMatch(textBeforeCursor, /(?:^|[\s([{])(\*\*((?!\s)[^*\n]*?[^\s*])\*\*)$/, "bold", 2),
    markMatch(textBeforeCursor, /(?:^|[\s([{])(\*((?!\s)[^*\n]*?[^\s*])\*)$/, "italic", 1),
    markMatch(textBeforeCursor, /(?:^|[\s([{])(`((?!\s)[^`\n]*?[^\s`])`)$/, "code", 1),
    markMatch(textBeforeCursor, /(?:^|[\s([{])(~~((?!\s)[^~\n]*?[^\s~])~~)$/, "strike", 2),
    markMatch(textBeforeCursor, /(?:^|[\s([{])(==((?!\s)[^=\n]*?[^\s=])==)$/, "highlight", 2),
    markMatch(
      textBeforeCursor,
      /(?:^|[\s([{])(\[([^\]\n]+)\]\(([^)\s]+)\))$/,
      "link",
      1,
      (match) => {
        const href = match[3];
        return href && isAllowedUri(href) ? { href } : null;
      },
    ),
  ];
  const standard = standardMarks.find(Boolean);
  if (standard) return standard;

  const subscript = textBeforeCursor.match(/(~((?!\s)[^~\n]*?[^\s~])~)([^\s~]*)$/);
  if (subscript?.[1] && subscript[2] && !subscript[1].startsWith("~~")) {
    return {
      kind: "mark",
      raw: subscript[1],
      text: subscript[2],
      mark: "subscript",
      openingLength: 1,
      tailLength: subscript[3]?.length ?? 0,
    };
  }

  const superscript = textBeforeCursor.match(/(\^((?!\s)[^^\n]*?[^\s^])\^)([^\s^]*)$/);
  if (superscript?.[1] && superscript[2]) {
    return {
      kind: "mark",
      raw: superscript[1],
      text: superscript[2],
      mark: "superscript",
      openingLength: 1,
      tailLength: superscript[3]?.length ?? 0,
    };
  }

  const footnote = textBeforeCursor.match(/(?:^|[\s([{])(\[\^([A-Za-z0-9_-]+)\])$/);
  if (footnote?.[1] && footnote[2]) {
    return {
      kind: "node",
      raw: footnote[1],
      node: "footnoteReference",
      attributes: { label: footnote[2] },
      tailLength: 0,
    };
  }

  const emoji = textBeforeCursor.match(/(?:^|\s)(:([a-z0-9_+-]+):)$/i);
  const replacement = emoji?.[2] ? emojiShortcodes[emoji[2].toLowerCase()] : undefined;
  if (emoji?.[1] && replacement) {
    return { kind: "text", raw: emoji[1], replacement, tailLength: 0 };
  }

  return null;
}

function rangeHasMarks(transaction: Transaction, from: number, to: number) {
  let marked = false;
  transaction.doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.length > 0) marked = true;
    return !marked;
  });
  return marked;
}

export function findMarkdownShortcutAtSelection(transaction: Transaction): MarkdownShortcutMatch | null {
  const { selection } = transaction;
  if (!selection.empty || !selection.$from.parent.isTextblock || selection.$from.parent.type.name === "codeBlock") {
    return null;
  }

  const textBeforeCursor = selection.$from.parent.textBetween(0, selection.$from.parentOffset, "\n", "\ufffc");
  const match = matchMarkdownShortcut(textBeforeCursor);
  if (!match) return null;

  const rawTo = selection.from - match.tailLength;
  const rawFrom = rawTo - match.raw.length;
  if (rawFrom < selection.$from.start() || rangeHasMarks(transaction, rawFrom, rawTo)) return null;
  if (match.kind === "mark" && !transaction.doc.type.schema.marks[match.mark]) return null;
  if (match.kind === "node" && !transaction.doc.type.schema.nodes[match.node]) return null;
  return match;
}

function splitAtCursor(transaction: Transaction, position: number) {
  const $cursor = transaction.doc.resolve(position);
  const atEnd = $cursor.parentOffset === $cursor.parent.content.size;
  const listItem = $cursor.depth > 1 && ["listItem", "taskItem"].includes($cursor.node(-1).type.name)
    ? $cursor.node(-1).type
    : null;

  if (listItem) {
    const nextType = atEnd ? $cursor.node(-1).contentMatchAt(0).defaultType : null;
    const types = nextType ? [{ type: listItem }, { type: nextType }] : undefined;
    if (!canSplit(transaction.doc, position, 2, types)) return false;
    transaction.split(position, 2, types);
  } else {
    const defaultType = $cursor.depth > 0
      ? defaultBlockAt($cursor.node(-1).contentMatchAt($cursor.indexAfter(-1)))
      : null;
    const types = atEnd && defaultType ? [{ type: defaultType }] : undefined;
    if (!canSplit(transaction.doc, position, 1, types)) return false;
    transaction.split(position, 1, types);
  }

  transaction.setStoredMarks([]);
  transaction.setSelection(Selection.near(transaction.doc.resolve(position + 2), 1));
  return true;
}

export function applyMarkdownShortcut(transaction: Transaction, boundary: MarkdownShortcutBoundary) {
  const match = findMarkdownShortcutAtSelection(transaction);
  if (!match) return false;

  // Keep the conversion in its own undo step so Ctrl/Cmd+Z restores the
  // literal Markdown instead of removing the entire recently typed block.
  closeHistory(transaction);
  const rawTo = transaction.selection.from - match.tailLength;
  const rawFrom = rawTo - match.raw.length;
  let cursor: number;

  if (match.kind === "mark") {
    const contentEndBeforeDeletion = rawFrom + match.openingLength + match.text.length;
    transaction.delete(contentEndBeforeDeletion, rawTo);
    transaction.delete(rawFrom, rawFrom + match.openingLength);
    const contentEnd = rawFrom + match.text.length;
    transaction.addMark(rawFrom, contentEnd, transaction.doc.type.schema.marks[match.mark].create(match.attributes));
    cursor = transaction.selection.from;
  } else if (match.kind === "text") {
    transaction.insertText(match.replacement, rawFrom, rawTo);
    cursor = transaction.selection.from;
  } else {
    const node = transaction.doc.type.schema.nodes[match.node].create(match.attributes);
    transaction.replaceWith(rawFrom, rawTo, node);
    cursor = transaction.selection.from;
  }

  transaction.setStoredMarks([]);
  transaction.setSelection(TextSelection.create(transaction.doc, cursor));
  if (boundary === "space") {
    transaction.insertText(" ", cursor);
    transaction.removeMark(cursor, cursor + 1);
    transaction.setSelection(TextSelection.create(transaction.doc, cursor + 1));
    return true;
  }
  return splitAtCursor(transaction, cursor);
}

export const supportedEmojiShortcodes = emojiShortcodes;
