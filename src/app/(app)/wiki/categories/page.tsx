import { requireUser } from "@/lib/auth";
import { listCategories, listCategoryEvidence } from "@/modules/wiki/category-queries";
import { CategoryWorkspace } from "@/modules/wiki/components/category-workspace";

export default async function WikiCategoriesPage({ searchParams }: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requireUser();
  const categories = listCategories();
  // Default to the first entry so the page is never an empty shell once an outline exists.
  const selectedId = (await searchParams).id ?? categories[0]?.id ?? "";
  const evidence = selectedId ? listCategoryEvidence(selectedId) : [];
  return <CategoryWorkspace categories={categories} selectedId={selectedId} evidence={evidence} />;
}
