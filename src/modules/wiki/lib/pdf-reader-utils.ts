export type FitMode = "custom" | "width" | "page" | "actual";
export type NavigatorTab = "pages" | "search" | "outline";
export type PdfViewMode = "continuous" | "single" | "double";

export type PdfReaderPreferences = {
  version: 1;
  viewMode: PdfViewMode;
  fitMode: FitMode;
  scale: number;
  rotation: number;
  navigatorTab: NavigatorTab;
  navigatorVisible: boolean;
  navigatorWidth: number;
  commentPanelWidth: number;
};

export type SearchOccurrence = {
  id: string;
  pageNumber: number;
  start: number;
  end: number;
  snippet: string;
};

export type SearchMatchGeometry = {
  pageNumber: number;
  occurrenceId: string;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
};

export const PDF_READER_PREFERENCES_KEY = "wiki:pdf-reader-preferences:v1";

export const DEFAULT_PDF_READER_PREFERENCES: PdfReaderPreferences = {
  version: 1,
  viewMode: "continuous",
  fitMode: "custom",
  scale: 1.25,
  rotation: 0,
  navigatorTab: "pages",
  navigatorVisible: true,
  navigatorWidth: 132,
  commentPanelWidth: 304,
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
    const value = JSON.parse(raw) as Partial<PdfReaderPreferences>;
    return {
      version: 1,
      viewMode: viewModes.has(value.viewMode as PdfViewMode) ? value.viewMode as PdfViewMode : DEFAULT_PDF_READER_PREFERENCES.viewMode,
      fitMode: fitModes.has(value.fitMode as FitMode) ? value.fitMode as FitMode : DEFAULT_PDF_READER_PREFERENCES.fitMode,
      scale: clamp(value.scale, 0.5, 3, DEFAULT_PDF_READER_PREFERENCES.scale),
      rotation: typeof value.rotation === "number" && [0, 90, 180, 270].includes(value.rotation) ? value.rotation : 0,
      navigatorTab: navigatorTabs.has(value.navigatorTab as NavigatorTab) ? value.navigatorTab as NavigatorTab : DEFAULT_PDF_READER_PREFERENCES.navigatorTab,
      navigatorVisible: typeof value.navigatorVisible === "boolean" ? value.navigatorVisible : true,
      navigatorWidth: clamp(value.navigatorWidth, 104, 320, DEFAULT_PDF_READER_PREFERENCES.navigatorWidth),
      commentPanelWidth: clamp(value.commentPanelWidth, 260, 420, DEFAULT_PDF_READER_PREFERENCES.commentPanelWidth),
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

function normalizedSearchText(value: string) {
  return value.toLocaleLowerCase();
}

export function findSearchOccurrences(
  pages: Array<{ pageNumber: number; text: string }>,
  query: string,
): SearchOccurrence[] {
  const needle = normalizedSearchText(query.trim());
  if (!needle) return [];
  const results: SearchOccurrence[] = [];
  for (const page of pages) {
    const haystack = normalizedSearchText(page.text);
    let cursor = 0;
    while (cursor <= haystack.length - needle.length) {
      const start = haystack.indexOf(needle, cursor);
      if (start < 0) break;
      const end = start + needle.length;
      const snippetStart = Math.max(0, start - 45);
      const snippetEnd = Math.min(page.text.length, end + 65);
      results.push({
        id: `${page.pageNumber}:${start}:${end}`,
        pageNumber: page.pageNumber,
        start,
        end,
        snippet: `${snippetStart > 0 ? "…" : ""}${page.text.slice(snippetStart, snippetEnd).replace(/\s+/g, " ")}${snippetEnd < page.text.length ? "…" : ""}`,
      });
      cursor = Math.max(end, start + 1);
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
