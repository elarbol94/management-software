import { requireUser } from "@/lib/auth";
import { searchResearch } from "@/modules/wiki/research-actions";
import { SearchResultsView } from "@/modules/wiki/components/search-results-view";

export default async function WikiSearchPage({ searchParams }: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  await requireUser();
  const query = (await searchParams).q?.trim() ?? "";
  const kind = (await searchParams).kind ?? "all";
  const { results } = query ? await searchResearch(query, 200) : { results: [] };
  return <SearchResultsView query={query} kind={kind} results={results} />;
}
