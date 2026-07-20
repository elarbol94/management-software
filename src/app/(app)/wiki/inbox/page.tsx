import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Clock3, Inbox } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listInboxPages } from "@/modules/wiki/research-queries";
import { QuickNoteButton } from "@/modules/wiki/components/workspace-actions";

export default async function InboxPage() {
  await requireUser();
  const t = await getTranslations("wiki");
  const pages = listInboxPages();
  return <main className="mx-auto max-w-5xl p-5 md:p-8">
    <header className="mb-7 flex items-end justify-between gap-4 border-b pb-5">
      <div><p className="mb-1 text-xs font-semibold tracking-[0.16em] text-indigo-600 uppercase">{t("captureAndTriage")}</p><h1 className="text-3xl font-semibold tracking-tight">{t("inbox")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("inboxDescription")}</p></div>
      <QuickNoteButton />
    </header>
    {pages.length === 0 ? <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/20 text-center"><div><Inbox className="mx-auto mb-3 size-8 text-indigo-400" /><h2 className="font-medium">{t("inboxEmpty")}</h2><p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("inboxEmptyDescription")}</p></div></div> :
      <div className="divide-y rounded-xl border bg-card">{pages.map((page) => <Link key={page.id} href={`/wiki/pages/${page.slug}`} className="group grid gap-2 p-4 transition-colors hover:bg-indigo-50/60 md:grid-cols-[1fr_auto] dark:hover:bg-indigo-950/20"><div className="min-w-0"><h2 className="truncate font-medium group-hover:text-indigo-700 dark:group-hover:text-indigo-300">{page.title}</h2><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{page.contentText || t("emptyNote")}</p>{page.tags && <div className="mt-2 flex gap-1">{page.tags.split(",").map((tag) => <span key={tag} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">{tag}</span>)}</div>}</div><p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{new Date(page.updatedAt).toLocaleDateString()}</p></Link>)}</div>}
  </main>;
}
