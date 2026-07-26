import { getSchema, Mark } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  MarkdownDocumentExtensions,
  MarkdownShortcutMarks,
} from "../components/markdown-shortcut-extension";
import {
  applyMarkdownShortcut,
  findMarkdownShortcutAtSelection,
  matchMarkdownShortcut,
  type MarkdownShortcutBoundary,
  type MarkdownShortcutMark,
} from "./markdown-shortcuts";

const TestHighlight = Mark.create({
  name: "highlight",
  parseHTML: () => [{ tag: "mark" }],
  renderHTML: () => ["mark", 0],
});

const schema = getSchema([
  StarterKit.configure({ bold: false, code: false, italic: false, strike: false }),
  ...MarkdownShortcutMarks,
  ...MarkdownDocumentExtensions,
  TestHighlight,
  TaskList,
  TaskItem,
]);

const conversionCases: Array<{
  input: string;
  mark: MarkdownShortcutMark;
  text: string;
  markedText: string;
}> = [
  { input: "**bold**", mark: "bold", text: "bold", markedText: "bold" },
  { input: "*italic*", mark: "italic", text: "italic", markedText: "italic" },
  { input: "`const value = 1`", mark: "code", text: "const value = 1", markedText: "const value = 1" },
  { input: "[OpenAI](https://openai.com)", mark: "link", text: "OpenAI", markedText: "OpenAI" },
  { input: "~~gone~~", mark: "strike", text: "gone", markedText: "gone" },
  { input: "==important==", mark: "highlight", text: "important", markedText: "important" },
  { input: "H~2~O", mark: "subscript", text: "H2O", markedText: "2" },
  { input: "X^2^", mark: "superscript", text: "X2", markedText: "2" },
];

function transactionFor(input: string, mark?: MarkdownShortcutMark, nodeType = "paragraph") {
  const marks = mark ? [schema.marks[mark].create()] : undefined;
  const text = schema.text(input, marks);
  const doc = schema.node("doc", null, [schema.node(nodeType, null, [text])]);
  const selection = TextSelection.create(doc, input.length + 1);
  return EditorState.create({ schema, doc, selection }).tr;
}

function markedText(transaction: ReturnType<typeof transactionFor>, markName: string) {
  let value = "";
  transaction.doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === markName)) value += node.text ?? "";
  });
  return value;
}

describe("matchMarkdownShortcut", () => {
  it.each(conversionCases)("$input becomes $mark", ({ input, mark, markedText }) => {
    expect(matchMarkdownShortcut(`Before ${input}`)).toMatchObject({
      kind: "mark",
      mark,
      text: markedText,
    });
  });

  it("matches emoji and footnote references", () => {
    expect(matchMarkdownShortcut("Funny :joy:")).toMatchObject({
      kind: "text",
      replacement: "😂",
    });
    expect(matchMarkdownShortcut("Sentence [^1]")).toMatchObject({
      kind: "node",
      node: "footnoteReference",
      attributes: { label: "1" },
    });
  });

  it.each([
    ["->", "→"],
    ["<-", "←"],
    ["-->", "⟶"],
    ["<->", "↔"],
  ])("matches the Markdown arrow %s", (input, replacement) => {
    expect(matchMarkdownShortcut(`Direction ${input}`)).toMatchObject({ kind: "text", replacement });
  });

  it.each([
    "**unfinished",
    "* spaced *",
    String.raw`\**escaped**`,
    "joined**bold**",
    "**line\nbreak**",
    "***",
    "```",
    "~~~",
    "====",
    "__not-in-the-request__",
    "_not-in-the-request_",
    "[unsafe](javascript:alert)",
    "[missing URL]()",
    ":unknown_emoji:",
  ])("ignores unsupported, malformed, or unsafe input: %s", (input) => {
    expect(matchMarkdownShortcut(input)).toBeNull();
  });
});

describe("applyMarkdownShortcut", () => {
  it.each(
    conversionCases.flatMap((item) =>
      (["space", "enter"] as MarkdownShortcutBoundary[]).map((boundary) => ({ ...item, boundary })),
    ),
  )("converts $input on $boundary", ({ input, mark, text, markedText: expectedMarkedText, boundary }) => {
    const transaction = transactionFor(input);
    expect(applyMarkdownShortcut(transaction, boundary)).toBe(true);
    expect(transaction.doc.firstChild?.textContent).toBe(text + (boundary === "space" ? " " : ""));
    expect(markedText(transaction, mark)).toBe(expectedMarkedText);
    if (boundary === "enter") expect(transaction.doc.childCount).toBe(2);
  });

  it("keeps the following word outside the converted mark", () => {
    const transaction = transactionFor("Before **bold**");
    expect(applyMarkdownShortcut(transaction, "space")).toBe(true);
    const paragraph = transaction.doc.firstChild!;
    expect(paragraph.textContent).toBe("Before bold ");
    expect(markedText(transaction, "bold")).toBe("bold");
    expect(paragraph.lastChild?.marks).toHaveLength(0);
  });

  it("creates a validated link mark", () => {
    const transaction = transactionFor("[OpenAI](https://openai.com)");
    expect(applyMarkdownShortcut(transaction, "space")).toBe(true);
    expect(transaction.doc.firstChild?.firstChild?.marks[0].attrs.href).toBe("https://openai.com");
  });

  it("replaces emoji and creates a footnote reference", () => {
    const emoji = transactionFor(":joy:");
    expect(applyMarkdownShortcut(emoji, "space")).toBe(true);
    expect(emoji.doc.firstChild?.textContent).toBe("😂 ");

    const footnote = transactionFor("[^note]");
    expect(applyMarkdownShortcut(footnote, "space")).toBe(true);
    expect(footnote.doc.firstChild?.firstChild?.type.name).toBe("footnoteReference");
    expect(footnote.doc.firstChild?.firstChild?.attrs.label).toBe("note");
  });

  it.each([
    ["->", "→"],
    ["<-", "←"],
    ["-->", "⟶"],
    ["<->", "↔"],
  ])("replaces arrow %s on both boundaries", (input, replacement) => {
    for (const boundary of ["space", "enter"] as MarkdownShortcutBoundary[]) {
      const transaction = transactionFor(input);
      expect(applyMarkdownShortcut(transaction, boundary)).toBe(true);
      expect(transaction.doc.firstChild?.textContent).toBe(replacement + (boundary === "space" ? " " : ""));
    }
  });

  it("does not convert inside code blocks or over existing formatting", () => {
    const codeTransaction = transactionFor("**bold**", undefined, "codeBlock");
    const markedTransaction = transactionFor("**bold**", "italic");
    expect(findMarkdownShortcutAtSelection(codeTransaction)).toBeNull();
    expect(findMarkdownShortcutAtSelection(markedTransaction)).toBeNull();
  });

  it.each([
    ["bulletList", "listItem"],
    ["taskList", "taskItem"],
  ])("splits a converted expression into a new %s item on Enter", (listName, itemName) => {
    const input = "*line*";
    const paragraph = schema.node("paragraph", null, [schema.text(input)]);
    const item = schema.node(itemName, itemName === "taskItem" ? { checked: false } : null, [paragraph]);
    const doc = schema.node("doc", null, [schema.node(listName, null, [item])]);
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, input.length + 3),
    });
    const transaction = state.tr;

    expect(applyMarkdownShortcut(transaction, "enter")).toBe(true);
    const list = transaction.doc.firstChild!;
    expect(list.childCount).toBe(2);
    expect(list.child(0).textContent).toBe("line");
    expect(markedText(transaction, "italic")).toBe("line");
    expect(list.child(1).textContent).toBe("");
  });
});
