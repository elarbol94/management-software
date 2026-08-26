import { normalizeDoi } from "./citations";

export type CrossrefContributor = {
  role: "author";
  given: string;
  family: string;
  literal: string;
};

export type CrossrefWork = {
  type: "journalArticle" | "bookChapter" | "book" | "document";
  title: string;
  subtitle: string;
  issuedDate: string;
  containerTitle: string;
  publisher: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  url: string;
  contributors: CrossrefContributor[];
};

const CROSSREF_TYPES: Record<string, CrossrefWork["type"]> = {
  "journal-article": "journalArticle",
  "book-chapter": "bookChapter",
  book: "book",
};

/**
 * Looks a DOI up at Crossref. Throws on a miss so the interactive lookup can report
 * why; background callers are expected to catch and carry on without metadata.
 */
export async function fetchCrossrefWork(value: string): Promise<CrossrefWork> {
  const doi = normalizeDoi(value);
  const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    signal: AbortSignal.timeout(8_000),
    headers: { "User-Agent": "CompanyHQ/0.1 (metadata lookup)" },
  });
  if (!response.ok) throw new Error("DOI metadata was not found");
  const item = (await response.json()).message;
  return {
    type: CROSSREF_TYPES[item.type as string] ?? "document",
    title: item.title?.[0] ?? "",
    subtitle: item.subtitle?.[0] ?? "",
    issuedDate: item.issued?.["date-parts"]?.[0]?.join("-") ?? "",
    containerTitle: item["container-title"]?.[0] ?? "",
    publisher: item.publisher ?? "",
    volume: item.volume ?? "",
    issue: item.issue ?? "",
    pages: item.page ?? "",
    doi,
    url: item.URL ?? "",
    contributors: (item.author ?? []).map((person: { given?: string; family?: string }) => ({
      role: "author" as const,
      given: person.given ?? "",
      family: person.family ?? "",
      literal: "",
    })),
  };
}
