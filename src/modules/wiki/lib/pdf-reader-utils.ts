import { DEFAULT_PDF_SHORTCUT_BINDINGS, parsePdfShortcutBindings, type PdfShortcutBindings } from "./pdf-shortcuts";

export type FitMode = "custom" | "width" | "page" | "actual";
export type NavigatorTab = "pages" | "search" | "outline";
export type PdfViewMode = "continuous" | "single" | "double";

export type PdfReaderPreferences = {
  version: 3;
  viewMode: PdfViewMode;
  fitMode: FitMode;
  scale: number;
  rotation: number;
  navigatorTab: NavigatorTab;
  navigatorVisible: boolean;
  navigatorWidth: number;
  commentPanelWidth: number;
  shortcuts: PdfShortcutBindings;
};

export type SearchOccurrence = {
  id: string;
  pageNumber: number;
  start: number;
  end: number;
  matchedText: string;
  contextBefore: string;
  contextAfter: string;
  pageOccurrenceIndex: number;
};

export type PdfSearchOptions = {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
};

export const PDF_READER_PREFERENCES_KEY = "wiki:pdf-reader-preferences:v3";

export const DEFAULT_PDF_READER_PREFERENCES: PdfReaderPreferences = {
  version: 3,
  viewMode: "continuous",
  fitMode: "custom",
  scale: 1.25,
  rotation: 0,
  navigatorTab: "pages",
  navigatorVisible: true,
  navigatorWidth: 132,
  commentPanelWidth: 304,
  shortcuts: DEFAULT_PDF_SHORTCUT_BINDINGS,
};

const fitModes = new Set<FitMode>(["custom", "width", "page", "actual"]);
const viewModes = new Set<PdfViewMode>(["continuous", "single", "double"]);
const navigatorTabs = new Set<NavigatorTab>(["pages", "search", "outline"]);

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function parsePdfReaderPreferences(raw: string | null): PdfReaderPreferences {
  if (!raw) return DEFAULT_PDF_READER_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Partial<Omit<PdfReaderPreferences, "version">> & { version?: number };
    const shortcuts = parsePdfShortcutBindings(value.shortcuts);
    // v2 briefly exposed Ctrl+G bindings while search-result navigation stayed
    // contextual. Restore the established Tab / Shift+Tab behavior on upgrade.
    if (shortcuts.previousMatch === "Ctrl+Shift+G" && shortcuts.nextMatch === "Ctrl+G") {
      shortcuts.previousMatch = DEFAULT_PDF_SHORTCUT_BINDINGS.previousMatch;
      shortcuts.nextMatch = DEFAULT_PDF_SHORTCUT_BINDINGS.nextMatch;
    }
    return {
      version: 3,
      viewMode: viewModes.has(value.viewMode as PdfViewMode) ? value.viewMode as PdfViewMode : DEFAULT_PDF_READER_PREFERENCES.viewMode,
      fitMode: fitModes.has(value.fitMode as FitMode) ? value.fitMode as FitMode : DEFAULT_PDF_READER_PREFERENCES.fitMode,
      scale: clamp(value.scale, 0.5, 3, DEFAULT_PDF_READER_PREFERENCES.scale),
      rotation: typeof value.rotation === "number" && [0, 90, 180, 270].includes(value.rotation) ? value.rotation : 0,
      navigatorTab: navigatorTabs.has(value.navigatorTab as NavigatorTab) ? value.navigatorTab as NavigatorTab : DEFAULT_PDF_READER_PREFERENCES.navigatorTab,
      navigatorVisible: typeof value.navigatorVisible === "boolean" ? value.navigatorVisible : true,
      navigatorWidth: clamp(value.navigatorWidth, 104, 320, DEFAULT_PDF_READER_PREFERENCES.navigatorWidth),
      commentPanelWidth: clamp(value.commentPanelWidth, 260, 420, DEFAULT_PDF_READER_PREFERENCES.commentPanelWidth),
      shortcuts,
    };
  } catch {
    return DEFAULT_PDF_READER_PREFERENCES;
  }
}

export function calculateFitScale(input: {
  mode: FitMode;
  pageWidth: number;
  pageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}) {
  if (input.mode === "actual") return 1;
  if (input.mode === "custom") return null;
  const padding = input.padding ?? 32;
  const widthScale = (input.viewportWidth - padding) / input.pageWidth;
  const heightScale = (input.viewportHeight - padding) / input.pageHeight;
  return Math.min(3, Math.max(0.5, input.mode === "width" ? widthScale : Math.min(widthScale, heightScale)));
}

export type NormalizedSearchText = {
  text: string;
  starts: number[];
  ends: number[];
};

const wordCharacter = /[\p{L}\p{N}_]/u;
const combiningMark = /\p{M}/u;

function foldCharacter(value: string, caseSensitive: boolean) {
  const decomposed = value.normalize("NFD");
  const folded = Array.from(decomposed).filter((character) => !combiningMark.test(character)).join("");
  return caseSensitive ? folded : folded.toLocaleLowerCase();
}

export function normalizePdfSearchText(value: string, caseSensitive = false): NormalizedSearchText {
  const text: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;
  const characters = Array.from(value);

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const start = cursor;
    cursor += character.length;

    if ((character === "-" || character === "\u00ad") && /^\s*$/.test(characters[index + 1] ?? "") && /[\r\n]/.test(characters[index + 1] ?? "")) {
      while (/^\s$/.test(characters[index + 1] ?? "")) {
        index += 1;
        cursor += characters[index].length;
      }
      continue;
    }

    if (/\s/u.test(character)) {
      while (/\s/u.test(characters[index + 1] ?? "")) {
        index += 1;
        cursor += characters[index].length;
      }
      if (text.length && text.at(-1) !== " ") {
        text.push(" ");
        starts.push(start);
        ends.push(cursor);
      }
      continue;
    }

    for (const folded of Array.from(foldCharacter(character, caseSensitive))) {
      text.push(folded);
      starts.push(start);
      ends.push(cursor);
    }
  }

  if (text.at(-1) === " ") {
    text.pop();
    starts.pop();
    ends.pop();
  }
  return { text: text.join(""), starts, ends };
}

export function findSearchOccurrences(
  pages: Array<{ pageNumber: number; text: string }>,
  options: string | PdfSearchOptions,
): SearchOccurrence[] {
  const resolved = typeof options === "string" ? { query: options } : options;
  const caseSensitive = resolved.caseSensitive ?? false;
  const needle = normalizePdfSearchText(resolved.query.trim(), caseSensitive).text;
  if (!needle) return [];
  const results: SearchOccurrence[] = [];
  for (const page of pages) {
    const normalized = normalizePdfSearchText(page.text, caseSensitive);
    const haystack = normalized.text;
    let cursor = 0;
    let pageOccurrenceIndex = 0;
    while (cursor <= haystack.length - needle.length) {
      const normalizedStart = haystack.indexOf(needle, cursor);
      if (normalizedStart < 0) break;
      const normalizedEnd = normalizedStart + needle.length;
      const before = haystack[normalizedStart - 1] ?? "";
      const after = haystack[normalizedEnd] ?? "";
      if (resolved.wholeWord && (wordCharacter.test(before) || wordCharacter.test(after))) {
        cursor = normalizedStart + 1;
        continue;
      }
      const start = normalized.starts[normalizedStart] ?? 0;
      const end = normalized.ends[normalizedEnd - 1] ?? start;
      const contextStart = Math.max(0, start - 55);
      const contextEnd = Math.min(page.text.length, end + 75);
      results.push({
        id: `${page.pageNumber}:${start}:${end}`,
        pageNumber: page.pageNumber,
        start,
        end,
        matchedText: page.text.slice(start, end).replace(/\s+/g, " "),
        contextBefore: `${contextStart > 0 ? "…" : ""}${page.text.slice(contextStart, start).replace(/\s+/g, " ")}`,
        contextAfter: `${page.text.slice(end, contextEnd).replace(/\s+/g, " ")}${contextEnd < page.text.length ? "…" : ""}`,
        pageOccurrenceIndex,
      });
      pageOccurrenceIndex += 1;
      cursor = Math.max(normalizedEnd, normalizedStart + 1);
    }
  }
  return results;
}

export function resolveInitialPage(input: {
  requestedPage?: number;
  storedPage?: number;
  pageCount: number;
}) {
  const valid = (value: number | undefined) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= input.pageCount;
  if (valid(input.requestedPage)) return Number(input.requestedPage);
  if (valid(input.storedPage)) return Number(input.storedPage);
  return 1;
}

export function virtualPageWindow(input: {
  pageOffsets: Array<{ pageNumber: number; top: number; bottom: number }>;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
  retainedPage?: number;
}) {
  const overscan = input.overscan ?? input.viewportHeight;
  const top = input.scrollTop - overscan;
  const bottom = input.scrollTop + input.viewportHeight + overscan;
  const pages = input.pageOffsets
    .filter((page) => page.bottom >= top && page.top <= bottom)
    .map((page) => page.pageNumber);
  if (input.retainedPage && !pages.includes(input.retainedPage)) pages.push(input.retainedPage);
  return pages.sort((left, right) => left - right);
}

export function formatPdfCitation(title: string, pageNumber: number, selectedText: string) {
  const quote = selectedText.trim().replace(/\s+/g, " ");
  return `${quote ? `“${quote}” — ` : ""}${title}, p. ${pageNumber}`;
}
