export const WIKI_SHORTCUT_ACTIONS = [
  "undo", "redo", "bold", "italic", "underline", "highlight", "strike", "inlineCode",
  "heading1", "heading2", "heading3", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule", "pageBreak", "tableOfContents", "twoColumns",
  "search", "outline", "inlineComment", "toggleComments", "documentMode", "markdownHelp", "typography", "shortcuts",
  "image", "pageLink", "externalLink", "citation", "pdfEvidence", "attachment", "supportingSource",
  "imageHighlight", "imageComment", "imageRegion", "imageWidth50", "imageWidth75", "imageWidth100", "imageAlignLeft", "imageAlignCenter", "imageAlignRight",
  "tableAddRow", "tableAddColumn", "tableHeader", "tableAlignLeft", "tableAlignCenter", "tableAlignRight", "tableDeleteRow", "tableDeleteColumn",
] as const;

export type WikiShortcutAction = typeof WIKI_SHORTCUT_ACTIONS[number];
export type WikiShortcutBindings = Record<WikiShortcutAction, string>;

export const WIKI_SHORTCUT_GROUPS: Array<{ label: "editing" | "structure" | "wiki" | "insert" | "context"; actions: WikiShortcutAction[] }> = [
  { label: "editing", actions: ["undo", "redo", "bold", "italic", "underline", "highlight", "strike", "inlineCode"] },
  { label: "structure", actions: ["heading1", "heading2", "heading3", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule", "pageBreak", "tableOfContents", "twoColumns"] },
  { label: "wiki", actions: ["search", "outline", "inlineComment", "toggleComments", "documentMode", "markdownHelp", "typography", "shortcuts"] },
  { label: "insert", actions: ["image", "pageLink", "externalLink", "citation", "pdfEvidence", "attachment", "supportingSource"] },
  { label: "context", actions: ["imageHighlight", "imageComment", "imageRegion", "imageWidth50", "imageWidth75", "imageWidth100", "imageAlignLeft", "imageAlignCenter", "imageAlignRight", "tableAddRow", "tableAddColumn", "tableHeader", "tableAlignLeft", "tableAlignCenter", "tableAlignRight", "tableDeleteRow", "tableDeleteColumn"] },
];

export const DEFAULT_WIKI_SHORTCUT_BINDINGS: WikiShortcutBindings = {
  undo: "Ctrl+Z", redo: "Ctrl+Shift+Z", bold: "Ctrl+B", italic: "Ctrl+I", underline: "Ctrl+U", highlight: "Ctrl+Alt+H", strike: "Ctrl+Alt+S", inlineCode: "Ctrl+Alt+C",
  heading1: "Ctrl+Alt+1", heading2: "Ctrl+Alt+2", heading3: "Ctrl+Alt+3", bulletList: "Ctrl+Alt+L", orderedList: "Ctrl+Alt+O", taskList: "Ctrl+Alt+T", blockquote: "Ctrl+Alt+Q", codeBlock: "Ctrl+Alt+K", horizontalRule: "Ctrl+Alt+-", pageBreak: "Ctrl+Alt+Enter", tableOfContents: "Ctrl+Alt+G", twoColumns: "Ctrl+Alt+W",
  search: "Ctrl+F", outline: "Ctrl+Alt+N", inlineComment: "Ctrl+Alt+M", toggleComments: "Ctrl+Alt+V", documentMode: "Ctrl+Alt+D", markdownHelp: "Ctrl+Alt+Y", typography: "Ctrl+Alt+P", shortcuts: "Ctrl+/",
  image: "Ctrl+Alt+I", pageLink: "Ctrl+Alt+J", externalLink: "Ctrl+K", citation: "Ctrl+Alt+X", pdfEvidence: "Ctrl+Alt+E", attachment: "Ctrl+Alt+A", supportingSource: "Ctrl+Alt+R",
  imageHighlight: "Ctrl+Alt+Shift+H", imageComment: "Ctrl+Alt+Shift+M", imageRegion: "Ctrl+Alt+Shift+R", imageWidth50: "Ctrl+Alt+5", imageWidth75: "Ctrl+Alt+7", imageWidth100: "Ctrl+Alt+0", imageAlignLeft: "Ctrl+Alt+ArrowLeft", imageAlignCenter: "Ctrl+Alt+ArrowDown", imageAlignRight: "Ctrl+Alt+ArrowRight",
  tableAddRow: "Ctrl+Alt+Shift+N", tableAddColumn: "Ctrl+Alt+Shift+C", tableHeader: "Ctrl+Alt+Shift+T", tableAlignLeft: "Ctrl+Alt+Shift+ArrowLeft", tableAlignCenter: "Ctrl+Alt+Shift+ArrowDown", tableAlignRight: "Ctrl+Alt+Shift+ArrowRight", tableDeleteRow: "Ctrl+Alt+Delete", tableDeleteColumn: "Ctrl+Alt+Shift+Delete",
};

const reservedShortcutKeys = new Set(["Tab", "Escape", "F5", "F11", "F12"]);
const canonicalKey = (key: string) => key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;

export function normalizeWikiShortcut(input: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey?: boolean }) {
  if (!(input.ctrlKey || input.metaKey) || ["Control", "Shift", "Alt", "Meta"].includes(input.key)) return null;
  const key = canonicalKey(input.key);
  const implicitCharacterShift = key.length === 1 && !/[\p{L}\p{N}]/u.test(key);
  return ["Ctrl", input.altKey ? "Alt" : "", input.shiftKey && !implicitCharacterShift ? "Shift" : "", key].filter(Boolean).join("+");
}

export function displayWikiShortcut(shortcut: string) {
  return shortcut.replaceAll("Ctrl", "Strg").replaceAll("ArrowLeft", "←").replaceAll("ArrowRight", "→").replaceAll("ArrowUp", "↑").replaceAll("ArrowDown", "↓").replaceAll("Delete", "Entf");
}

export function isReservedWikiShortcut(shortcut: string) {
  return reservedShortcutKeys.has(shortcut.split("+").at(-1) ?? "");
}

export function parseWikiShortcutBindings(value: unknown): WikiShortcutBindings {
  if (!value || typeof value !== "object") return { ...DEFAULT_WIKI_SHORTCUT_BINDINGS };
  const candidate = value as Partial<Record<WikiShortcutAction, unknown>>;
  return Object.fromEntries(WIKI_SHORTCUT_ACTIONS.map((action) => [action, typeof candidate[action] === "string" && !isReservedWikiShortcut(candidate[action]) ? candidate[action] : DEFAULT_WIKI_SHORTCUT_BINDINGS[action]])) as WikiShortcutBindings;
}

export function wikiShortcutConflicts(bindings: WikiShortcutBindings, action: WikiShortcutAction, shortcut: string) {
  return WIKI_SHORTCUT_ACTIONS.find((candidate) => candidate !== action && bindings[candidate] === shortcut) ?? null;
}
