export type Contributor = {
  role: "author" | "editor";
  given: string;
  family: string;
  literal: string;
  sortOrder: number;
};

export const CITATION_STYLES = ["ieee", "apa", "vancouver", "harvard1"] as const;
export type CitationStyle = (typeof CITATION_STYLES)[number];

/** Numeric styles cite by order of appearance; the rest cite by author and year. */
export function isNumericCitationStyle(style: CitationStyle) {
  return style === "ieee" || style === "vancouver";
}

export function isCitationStyle(value: string): value is CitationStyle {
  return (CITATION_STYLES as readonly string[]).includes(value);
}

/** Placeholder the server substitutes a locator into, so the client can render one without citeproc. */
export const LOCATOR_PLACEHOLDER = "{locator}";

export type CitationSource = {
  id: string;
  type: string;
  title: string;
  issuedDate: string;
  containerTitle: string;
  publisher: string;
  institution: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  url: string;
  accessedAt: string;
  contributors: Contributor[];
  /** Bibliography entry rendered server-side; citeproc cannot run in the editor. */
  renderedBibliography?: string;
  /** In-text citation without a locator, e.g. "(Müller, 2024)". Empty for numeric styles. */
  renderedInline?: string;
  /** Same, with LOCATOR_PLACEHOLDER where the page number goes, e.g. "(Müller, 2024, S. {locator})". */
  renderedInlineTemplate?: string;
  pdfDocumentId?: string;
};

function year(source: CitationSource) {
  return source.issuedDate.slice(0, 4) || "n.d.";
}

function dateParts(value: string) {
  const parts = value
    .split(/[-/]/)
    .map((part) => Number(part))
    .filter((part) => Number.isInteger(part) && part > 0)
    .slice(0, 3);
  return parts.length ? { "date-parts": [parts] } : undefined;
}

export function toCslJson(source: CitationSource) {
  const type = {
    journalArticle: "article-journal",
    book: "book",
    bookChapter: "chapter",
    report: "report",
    webPage: "webpage",
    document: "document",
  }[source.type] ?? "document";
  return {
    id: source.id,
    type,
    title: source.title,
    author: source.contributors
      .filter((person) => person.role === "author")
      .map((person) => person.literal
        ? { literal: person.literal }
        : { given: person.given, family: person.family }),
    editor: source.contributors
      .filter((person) => person.role === "editor")
      .map((person) => person.literal
        ? { literal: person.literal }
        : { given: person.given, family: person.family }),
    issued: dateParts(source.issuedDate),
    accessed: dateParts(source.accessedAt),
    "container-title": source.containerTitle || undefined,
    publisher: source.publisher || source.institution || undefined,
    volume: source.volume || undefined,
    issue: source.issue || undefined,
    page: source.pages || undefined,
    DOI: source.doi || undefined,
    URL: source.url || undefined,
  };
}

function contributorLabel(source: CitationSource) {
  const authors = source.contributors.filter((person) => person.role === "author");
  if (authors.length === 0) return source.institution || source.publisher || source.title;
  const name = (person: Contributor) => {
    if (person.literal) return person.literal;
    const initials = person.given
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase()}.`)
      .join(" ");
    return [initials, person.family].filter(Boolean).join(" ");
  };
  return authors
    .map(name)
    .join(authors.length > 1 ? ", " : "");
}

export function formatInlineCitation(
  source: CitationSource,
  locator?: string,
  _locale = "en-US",
  citationNumber = 1,
  style: CitationStyle = "ieee",
) {
  void _locale;
  if (isNumericCitationStyle(style)) return formatIeeeCitation(citationNumber, locator);
  if (locator && source.renderedInlineTemplate) {
    return source.renderedInlineTemplate.replace(LOCATOR_PLACEHOLDER, locator);
  }
  return source.renderedInline || formatIeeeCitation(citationNumber, locator);
}

export function formatIeeeCitation(citationNumber: number, locator?: string) {
  return `[${citationNumber}${locator ? `, p. ${locator}` : ""}]`;
}

export function formatBibliographyEntry(source: CitationSource, locale = "en-US") {
  if (source.renderedBibliography) return source.renderedBibliography;
  void locale;
  const creators = contributorLabel(source);
  const issuedYear = year(source);
  const publisher = source.publisher || source.institution;
  const pages = source.pages ? `${source.pages.includes("-") ? "pp." : "p."} ${source.pages}` : "";
  const identifiers = [
    source.doi ? `doi: ${normalizeDoi(source.doi)}` : "",
    source.url ? `[Online]. Available: ${source.url}` : "",
  ].filter(Boolean);
  const authorPrefix = creators ? `${creators}, ` : "";
  let entry: string;
  if (source.type === "journalArticle") {
    entry = `${authorPrefix}“${source.title},”${source.containerTitle ? ` ${source.containerTitle}` : ""}${source.volume ? `, vol. ${source.volume}` : ""}${source.issue ? `, no. ${source.issue}` : ""}${pages ? `, ${pages}` : ""}, ${issuedYear}`;
  } else if (source.type === "bookChapter") {
    entry = `${authorPrefix}“${source.title},”${source.containerTitle ? ` in ${source.containerTitle}` : ""}${publisher ? `, ${publisher}` : ""}, ${issuedYear}${pages ? `, ${pages}` : ""}`;
  } else if (source.type === "book") {
    entry = `${authorPrefix}${source.title}${publisher ? `, ${publisher}` : ""}, ${issuedYear}`;
  } else {
    entry = `${authorPrefix}“${source.title},”${publisher ? ` ${publisher},` : ""} ${issuedYear}`;
  }
  return `${entry}${identifiers.length ? `, ${identifiers.join(", ")}` : ""}.`.replace(/\s+/g, " ").trim();
}

export function formatBibliography(
  sources: CitationSource[],
  locale = "en-US",
  style: CitationStyle = "ieee",
) {
  const unique = [...new Map(sources.map((source) => [source.id, source])).values()];
  if (isNumericCitationStyle(style)) {
    return unique
      .map((source, index) => ({ source, text: `[${index + 1}] ${formatBibliographyEntry(source, locale)}` }));
  }
  // ponytail: author-date reference lists sort alphabetically, and every CSL style
  // renders the author first, so sorting the rendered string matches citeproc's own
  // order for all but exotic styles. Render the whole list through one Cite call if
  // a style ever needs true citeproc sorting.
  return unique
    .map((source) => ({ source, text: formatBibliographyEntry(source, locale) }))
    .sort((a, b) => a.text.localeCompare(b.text, locale));
}

export function normalizeDoi(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
}

export function normalizeIsbn(value: string) {
  return value.toUpperCase().replace(/[^0-9X]/g, "");
}

export function normalizeUrl(value: string) {
  if (!value.trim()) return "";
  try {
    const url = new URL(value.trim());
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}
