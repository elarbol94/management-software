import { redirect } from "next/navigation";
export default async function LegacyWikiPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/wiki/pages/${encodeURIComponent(slug)}`);
}
