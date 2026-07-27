import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getPageTree } from "@/modules/wiki/queries";
import { QuickNoteButton } from "@/modules/wiki/components/workspace-actions";

function flatten(nodes: ReturnType<typeof getPageTree>, depth = 0): Array<ReturnType<typeof getPageTree>[number] & { depth: number }> {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flatten(node.children, depth + 1)]);
}
export default async function PagesIndex() {
  await requireUser(); const t = await getTranslations("wiki"); const pages = flatten(getPageTree());
  return <main className="mx-auto max-w-5xl p-5 md:p-8"><header className="mb-7 flex items-end justify-between border-b pb-5"><div><p className="mb-1 text-xs font-semibold tracking-[0.16em] text-indigo-600 uppercase">{t("knowledgeBase")}</p><h1 className="text-3xl font-semibold tracking-tight">{t("documents")}</h1></div><QuickNoteButton /></header>
    <div className="divide-y rounded-xl border bg-card">{pages.map((page) => <Link key={page.id} href={`/wiki/pages/${page.slug}`} className="flex items-center gap-3 p-3 hover:bg-accent" style={{ paddingLeft: `${16 + page.depth * 22}px` }}><FileText className="size-4 text-indigo-400" /><span className="text-sm font-medium">{page.title}</span></Link>)}</div></main>;
}
