import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getBacklinks,
  getFirstPage,
  getPageBySlug,
  getPageMeta,
  getPageTree,
  listPagesFlat,
} from "@/modules/wiki/queries";
import { WikiShell } from "@/modules/wiki/components/wiki-shell";
import { WikiEmptyState } from "@/modules/wiki/components/wiki-empty-state";

export default async function WikiPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  await requireUser();
  const { slug } = await params;

  if (!slug || slug.length === 0) {
    const first = getFirstPage();
    if (first) redirect(`/wiki/${first.slug}`);
    return <WikiEmptyState />;
  }

  const page = getPageBySlug(decodeURIComponent(slug[0]));
  if (!page) notFound();

  const tree = getPageTree();
  const backlinks = getBacklinks(page.id);
  const meta = getPageMeta(page.id);
  const allPages = listPagesFlat();

  return (
    <WikiShell
      page={{
        id: page.id,
        title: page.title,
        slug: page.slug,
        contentJson: page.contentJson,
      }}
      tree={tree}
      backlinks={backlinks}
      allPages={allPages}
      meta={
        meta
          ? { updatedAt: meta.updatedAt.getTime(), updatedByName: meta.updatedByName }
          : null
      }
    />
  );
}
