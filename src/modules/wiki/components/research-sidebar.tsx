"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArchiveRestore, Bell, BookOpen, ChevronRight, FileText, Hash,
  Inbox, LibraryBig, Plus, Search, Star, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createQuickNote, searchResearch } from "../research-actions";
import type { WikiTreeNode } from "../queries";
import type { TagDto } from "../research-queries";
import { cn } from "@/lib/utils";

type SearchResults = Awaited<ReturnType<typeof searchResearch>>;

function NavItem({ href, icon: Icon, label, badge }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string; badge?: number }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/wiki/inbox" && pathname.startsWith(`${href}/`));
  return (
    <Link href={href} className={cn("flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", active && "bg-indigo-50 text-indigo-950 dark:bg-indigo-950/50 dark:text-indigo-100")}>
      <Icon className="size-4" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!!badge && <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] tabular-nums text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">{badge}</span>}
    </Link>
  );
}

function PageTree({ nodes, depth = 0 }: { nodes: WikiTreeNode[]; depth?: number }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return <>{nodes.map((node) => (
    <div key={node.id}>
      <div className="flex items-center" style={{ paddingLeft: `${depth * 10}px` }}>
        {node.children.length ? <button type="button" className="grid size-5 place-items-center text-muted-foreground" onClick={() => setClosed((value) => ({ ...value, [node.id]: !value[node.id] }))}><ChevronRight className={cn("size-3 transition-transform", !closed[node.id] && "rotate-90")} /></button> : <span className="w-5" />}
        <Link href={`/wiki/pages/${node.slug}`} className="min-w-0 flex-1 truncate rounded px-1 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">{node.icon ? `${node.icon} ` : ""}{node.title}</Link>
      </div>
      {!closed[node.id] && <PageTree nodes={node.children} depth={depth + 1} />}
    </div>
  ))}</>;
}

export function ResearchSidebar({ tree, tags, counts }: { tree: WikiTreeNode[]; tags: TagDto[]; counts: { inbox: number; sources: number; unread: number; trash: number } }) {
  const t = useTranslations("wiki");
  const locale = useLocale();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault(); void createNote();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); document.getElementById("research-search")?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  async function createNote() {
    setCreating(true);
    try { const note = await createQuickNote(locale === "en" ? "en" : "de"); router.push(`/wiki/pages/${note.slug}`); router.refresh(); }
    finally { setCreating(false); }
  }

  function updateSearch(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) { setResults(null); return; }
    timer.current = setTimeout(async () => setResults(await searchResearch(value)), 220);
  }

  return (
    <aside className="relative flex w-full shrink-0 flex-col border-b bg-[linear-gradient(180deg,rgba(79,70,229,0.045),transparent_14rem)] md:w-64 md:border-r md:border-b-0">
      <div className="flex items-center gap-2 border-b p-3">
        <div className="grid size-8 place-items-center rounded-md bg-indigo-600 text-white"><BookOpen className="size-4" /></div>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{t("researchWorkspace")}</p><p className="text-[11px] text-muted-foreground">{t("sharedKnowledge")}</p></div>
        <Button size="icon-sm" onClick={createNote} disabled={creating} title={t("quickNote")}><Plus className="size-4" /></Button>
      </div>

      <div className="relative p-3 pb-1">
        <Search className="absolute top-5 left-5 size-3.5 text-muted-foreground" />
        <Input id="research-search" value={query} onChange={(event) => updateSearch(event.target.value)} placeholder={t("searchEverything")} className="h-8 bg-background pl-7 pr-7 text-xs" />
        {query && <button className="absolute top-5 right-5 text-muted-foreground" onClick={() => { setQuery(""); setResults(null); }}><X className="size-3.5" /></button>}
        {results && <div className="absolute top-12 right-3 left-3 z-50 max-h-[28rem] overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
          {results.pages.length === 0 && results.sources.length === 0 && <p className="p-3 text-xs text-muted-foreground">{t("noResults")}</p>}
          {results.pages.length > 0 && <p className="px-2 py-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t("pages")}</p>}
          {results.pages.map((item) => <Link key={item.id} href={`/wiki/pages/${item.slug}`} onClick={() => { setQuery(""); setResults(null); }} className="block rounded-md px-2 py-1.5 hover:bg-accent"><span className="block text-xs font-medium">{item.title}</span><span className="block truncate text-[11px] text-muted-foreground" dangerouslySetInnerHTML={{ __html: item.snippet }} /></Link>)}
          {results.sources.length > 0 && <p className="mt-1 border-t px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t("sources")}</p>}
          {results.sources.map((item) => <Link key={item.id} href={`/wiki/sources/${item.id}`} onClick={() => { setQuery(""); setResults(null); }} className="block rounded-md px-2 py-1.5 hover:bg-accent"><span className="block text-xs font-medium">{item.title}</span><span className="block truncate text-[11px] text-muted-foreground">{item.type} · {item.issuedDate || "—"}</span></Link>)}
        </div>}
      </div>

      <nav className="grid grid-cols-4 gap-1 p-3 md:flex md:flex-col md:overflow-y-auto">
        <NavItem href="/wiki/inbox" icon={Inbox} label={t("inbox")} badge={counts.inbox} />
        <NavItem href="/wiki/pages" icon={FileText} label={t("pages")} />
        <NavItem href="/wiki/sources" icon={LibraryBig} label={t("sources")} badge={counts.sources} />
        <NavItem href="/wiki/favorites" icon={Star} label={t("favorites")} />
        <div className="contents md:block">
          <NavItem href="/wiki/notifications" icon={Bell} label={t("notifications")} badge={counts.unread} />
          <NavItem href="/wiki/trash" icon={Trash2} label={t("trash")} badge={counts.trash} />
        </div>
        <div className="mt-3 hidden border-t pt-3 md:block">
          <p className="mb-1 flex items-center gap-1 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"><ArchiveRestore className="size-3" />{t("pageTree")}</p>
          <PageTree nodes={tree} />
        </div>
        {tags.length > 0 && <div className="mt-3 hidden border-t pt-3 md:block">
          <p className="mb-1 flex items-center gap-1 px-2 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"><Hash className="size-3" />{t("tags")}</p>
          {tags.map((tag) => <Link key={tag.id} href={`/wiki/tags/${tag.id}`} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"><span className="size-1.5 rounded-full bg-indigo-500" />{tag.name}</Link>)}
        </div>}
      </nav>
    </aside>
  );
}
