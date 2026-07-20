export type Contributor = {
  role: "author" | "editor";
  given: string;
  family: string;
  literal: string;
  sortOrder: number;
};

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
};

function year(source: CitationSource) {
  return source.issuedDate.slice(0, 4) || "n.d.";
}

function contributorLabel(source: CitationSource, bibliography = false) {
  const authors = source.contributors.filter((person) => person.role === "author");
  if (authors.length === 0) return source.institution || source.publisher || source.title;
  const name = (person: Contributor) => person.literal || person.family || person.given;
  if (!bibliography) {
    if (authors.length === 1) return name(authors[0]);
    if (authors.length === 2) return `${name(authors[0])} & ${name(authors[1])}`;
    return `${name(authors[0])} et al.`;
  }
  return authors
    .map((person) => {
      if (person.literal) return person.literal;
      const initials = person.given
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase()}.`)
        .join(" ");
      return [person.family, initials].filter(Boolean).join(", ");
    })
    .join(authors.length > 1 ? ", & " : "");
}

export function formatInlineCitation(
  source: CitationSource,
  locator?: string,
  locale = "en-US",
) {
  const pageLabel = locale.startsWith("de") ? "S." : "p.";
  return `(${contributorLabel(source)}, ${year(source)}${locator ? `, ${pageLabel} ${locator}` : ""})`;
}

export function formatBibliographyEntry(source: CitationSource) {
  const creators = contributorLabel(source, true);
  const date = year(source);
  const container = source.containerTitle ? ` ${source.containerTitle}` : "";
  const volume = source.volume ? `, ${source.volume}${source.issue ? `(${source.issue})` : ""}` : "";
  const pages = source.pages ? `, ${source.pages}` : "";
  const publisher = source.publisher || source.institution;
  const link = source.doi
    ? ` https://doi.org/${source.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}`
    : source.url
      ? ` ${source.url}`
      : "";
  if (source.type === "journalArticle") {
    return `${creators} (${date}). ${source.title}.${container}${volume}${pages}.${link}`.replace(/\s+/g, " ").trim();
  }
  return `${creators} (${date}). ${source.title}.${publisher ? ` ${publisher}.` : ""}${link}`.replace(/\s+/g, " ").trim();
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
