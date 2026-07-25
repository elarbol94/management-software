export const PDF_SHORTCUT_ACTIONS = [
  "previousPage", "nextPage", "zoomOut", "zoomIn", "fitWidth", "fitPage", "actualSize",
  "continuousView", "singlePageView", "doublePageView", "search", "previousMatch", "nextMatch",
  "caseSensitive", "wholeWord", "navigatorPages", "navigatorSearch", "outline", "captureRegion",
  "bookmarkPage", "comments", "previousAnnotation", "nextAnnotation", "backToComments", "copyCitation",
  "editAnnotation", "deleteAnnotation", "rotate", "toggleNavigator", "openOriginal", "download", "printPdf",
  "focusMode", "shortcuts",
] as const;

export type PdfShortcutAction = typeof PDF_SHORTCUT_ACTIONS[number];
export type PdfShortcutBindings = Record<PdfShortcutAction, string>;

export const PDF_SHORTCUT_GROUPS: Array<{ label: string; actions: PdfShortcutAction[] }> = [
  { label: "Navigation und Zoom", actions: ["previousPage", "nextPage", "zoomOut", "zoomIn", "fitWidth", "fitPage", "actualSize"] },
  { label: "Ansichten", actions: ["continuousView", "singlePageView", "doublePageView"] },
  { label: "Suche", actions: ["search", "previousMatch", "nextMatch", "caseSensitive", "wholeWord"] },
  { label: "Navigator", actions: ["navigatorPages", "navigatorSearch", "outline", "toggleNavigator"] },
  { label: "Kommentare und Markierungen", actions: ["captureRegion", "bookmarkPage", "comments", "previousAnnotation", "nextAnnotation", "backToComments", "copyCitation", "editAnnotation", "deleteAnnotation"] },
  { label: "Dokument und Oberfläche", actions: ["rotate", "openOriginal", "download", "printPdf", "focusMode", "shortcuts"] },
];

export const PDF_SHORTCUT_LABELS: Record<PdfShortcutAction, string> = {
  previousPage: "Vorherige Seite", nextPage: "Nächste Seite", zoomOut: "Verkleinern", zoomIn: "Vergrößern",
  fitWidth: "An Breite anpassen", fitPage: "Ganze Seite", actualSize: "Originalgröße",
  continuousView: "Fortlaufende Ansicht", singlePageView: "Einzelseite", doublePageView: "Doppelseite",
  search: "PDF durchsuchen", previousMatch: "Vorheriger Treffer", nextMatch: "Nächster Treffer",
  caseSensitive: "Groß-/Kleinschreibung", wholeWord: "Nur ganze Wörter", navigatorPages: "Seiten", navigatorSearch: "Suche", outline: "Gliederung",
  captureRegion: "Bereich markieren", bookmarkPage: "Seite merken", comments: "Kommentare", previousAnnotation: "Vorheriger Kommentar", nextAnnotation: "Nächster Kommentar", backToComments: "Zurück zu Kommentaren", copyCitation: "Zitat kopieren", editAnnotation: "Annotation bearbeiten", deleteAnnotation: "Annotation löschen",
  rotate: "Drehen", toggleNavigator: "Navigator ein-/ausblenden", openOriginal: "Original öffnen", download: "Herunterladen", printPdf: "Drucken", focusMode: "Fokusmodus", shortcuts: "Tastenkürzel",
};

export const DEFAULT_PDF_SHORTCUT_BINDINGS: PdfShortcutBindings = {
  previousPage: "Ctrl+ArrowLeft", nextPage: "Ctrl+ArrowRight", zoomOut: "Ctrl+-", zoomIn: "Ctrl++",
  fitWidth: "Ctrl+W", fitPage: "Ctrl+Shift+W", actualSize: "Ctrl+0", continuousView: "Ctrl+1", singlePageView: "Ctrl+2", doublePageView: "Ctrl+3",
  search: "Ctrl+F", previousMatch: "Shift+Tab", nextMatch: "Tab", caseSensitive: "Ctrl+Alt+C", wholeWord: "Ctrl+Alt+W",
  navigatorPages: "Ctrl+Alt+1", navigatorSearch: "Ctrl+Alt+2", outline: "Ctrl+Alt+3", captureRegion: "Ctrl+R", bookmarkPage: "Ctrl+B", comments: "Ctrl+M",
  previousAnnotation: "Ctrl+Alt+ArrowUp", nextAnnotation: "Ctrl+Alt+ArrowDown", backToComments: "Ctrl+Alt+ArrowLeft", copyCitation: "Ctrl+Shift+C", editAnnotation: "Ctrl+E", deleteAnnotation: "Ctrl+Delete",
  rotate: "Ctrl+Alt+R", toggleNavigator: "Ctrl+N", openOriginal: "Ctrl+O", download: "Ctrl+S", printPdf: "Ctrl+P", focusMode: "Ctrl+Shift+F", shortcuts: "Ctrl+/",
};

const canonicalKey = (key: string) => key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;
const reservedShortcutKeys = new Set(["Tab", "Escape", "F5", "F11", "F12"]);

export function normalizePdfShortcut(input: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey?: boolean }) {
  if (!(input.ctrlKey || input.metaKey) || ["Control", "Shift", "Alt", "Meta"].includes(input.key)) return null;
  const key = canonicalKey(input.key);
  // On many keyboard layouts, characters such as + and / intrinsically need
  // Shift. The semantic key already contains that character, so recording the
  // physical Shift modifier would make the configured shortcut impossible to match.
  const implicitCharacterShift = key.length === 1 && !/[\p{L}\p{N}]/u.test(key);
  return ["Ctrl", input.altKey ? "Alt" : "", input.shiftKey && !implicitCharacterShift ? "Shift" : "", key].filter(Boolean).join("+");
}

export function displayPdfShortcut(shortcut: string) {
  return shortcut.replaceAll("Ctrl", "Strg").replaceAll("ArrowLeft", "←").replaceAll("ArrowRight", "→").replaceAll("ArrowUp", "↑").replaceAll("ArrowDown", "↓").replaceAll("Delete", "Entf");
}

export function isReservedPdfShortcut(shortcut: string) {
  return reservedShortcutKeys.has(shortcut.split("+").at(-1) ?? "");
}

export function parsePdfShortcutBindings(value: unknown): PdfShortcutBindings {
  if (!value || typeof value !== "object") return { ...DEFAULT_PDF_SHORTCUT_BINDINGS };
  const candidate = value as Partial<Record<PdfShortcutAction, unknown>>;
  return Object.fromEntries(PDF_SHORTCUT_ACTIONS.map((action) => [action, typeof candidate[action] === "string" && !isReservedPdfShortcut(candidate[action]) ? candidate[action] : DEFAULT_PDF_SHORTCUT_BINDINGS[action]])) as PdfShortcutBindings;
}

export function shortcutConflicts(bindings: PdfShortcutBindings, action: PdfShortcutAction, shortcut: string) {
  return PDF_SHORTCUT_ACTIONS.find((candidate) => candidate !== action && bindings[candidate] === shortcut) ?? null;
}
