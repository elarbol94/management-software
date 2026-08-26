import { requireUser } from "@/lib/auth";
import { searchResearch } from "@/modules/wiki/research-actions";
import { listTags } from "@/modules/wiki/research-queries";
import { SearchResultsView } from "@/modules/wiki/components/search-results-view";

export default async function WikiSearchPage({ searchParams }: {
  searchParams: Promise<{ q?: string; kind?: string; tag?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const kind = params.kind ?? "all";
  const tagId = params.tag ?? "";
  const { results } = query
    ? await searchResearch(query, { limit: 200, tagId: tagId || undefined })
    : { results: [] };
  return <SearchResultsView query={query} kind={kind} tagId={tagId} tags={listTags()} results={results} />;
}
