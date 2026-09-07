"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { FileDown, FileText, MoreHorizontal, Play, Plus, Presentation, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { PresentationListItem } from "../presentation-queries";
import { PresentationScene } from "./presentation-scene";
import { PresentationImport } from "./presentation-import";
import { DeletePresentationButton, NewPresentationForm, NewPresentationFromWikiPage } from "./presentation-list-actions";

export function PresentationLibrary({ presentations, pages }: { presentations: PresentationListItem[]; pages: Array<{ id: string; title: string }> }) {
  const t = useTranslations("wiki");
  const studio = useTranslations("presentationStudio");
  const format = useFormatter();
  const [creation, setCreation] = useState<"blank" | "document" | "import" | null>(null);
  const [query, setQuery] = useState("");
  const visible = presentations.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return <div className="mx-auto max-w-7xl px-5 py-8 md:px-10 md:py-10">
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("presentations.title")}</h1><p className="mt-2 max-w-xl text-sm text-muted-foreground">{t("presentations.description")}</p></div>
      <div className="flex items-center gap-3">
        <Link href="/wiki/presentations/follow" className="text-sm text-muted-foreground hover:text-foreground">{t("presentations.joinLive")}</Link>
        <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" />}><Plus className="size-4" />{t("presentations.new")}</DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setCreation("blank")}><Presentation />{t("workspace.blankOrTemplate")}</DropdownMenuItem>
          <DropdownMenuItem disabled={!pages.length} onClick={() => setCreation("document")}><FileText />{t("presentations.fromWikiPage")}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCreation("import")}><Upload />{studio("importPptx")}</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </div>
    </header>
    <NewPresentationForm hideTrigger open={creation === "blank"} onOpenChange={(open) => setCreation(open ? "blank" : null)} />
    <NewPresentationFromWikiPage hideTrigger pages={pages} open={creation === "document"} onOpenChange={(open) => setCreation(open ? "document" : null)} />
    <PresentationImport hideTrigger open={creation === "import"} onOpenChange={(open) => setCreation(open ? "import" : null)} />
    {presentations.length > 0 && <div className="relative mb-6 max-w-sm"><Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("workspace.searchPresentations")} placeholder={t("workspace.searchPresentations")} /></div>}
    {!presentations.length ? <div className="grid min-h-72 place-items-center rounded-2xl bg-muted/30 p-8 text-center"><div><Presentation className="mx-auto mb-4 size-9 text-muted-foreground/60" /><h2 className="font-medium">{t("presentations.empty")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("presentations.emptyDescription")}</p></div></div>
      : !visible.length ? <p className="py-12 text-sm text-muted-foreground">{t("noSearchResults")}</p>
      : <ul className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">{visible.map((item) => <li key={item.id} className="group min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card transition-shadow hover:shadow-md">
        <Link href={`/wiki/presentations/${item.id}`} aria-label={item.title} className="block focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
          <div className="aspect-video overflow-hidden border-b border-border/50 bg-muted/30 p-3" aria-hidden="true" inert style={{ contentVisibility: "auto", containIntrinsicSize: "400px 225px" }}>
            {item.elementCount ? <div className="pointer-events-none h-full w-full overflow-hidden rounded-sm bg-white shadow-sm"><PresentationScene presentation={item.preview} index={0} interactive={false} /></div> : <div className="grid h-full place-items-center"><Presentation className="size-10 text-muted-foreground/30" /></div>}
          </div>
          <h2 className="line-clamp-2 px-4 pt-4 text-base font-medium tracking-tight">{item.title}</h2>
        </Link>
        <div className="flex items-center gap-2 px-4 pt-2 pb-4">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={item.updatedByName ?? undefined}>{format.dateTime(item.updatedAt, { dateStyle: "medium", timeZone: "Europe/Vienna" })}{item.updatedByName && ` · ${item.updatedByName}`}</p>
          {item.stepCount > 0 && <Link href={`/wiki/presentations/${item.id}/present`} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-accent"><Play className="size-3.5" />{t("presentations.present")}</Link>}
          <DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t("workspace.itemActions", { title: item.title })} />}><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem render={<Link href={`/wiki/presentations/${item.id}`} />}>{t("edit")}</DropdownMenuItem>
            {item.stepCount > 0 && <DropdownMenuItem render={<a href={`/print/presentations/${item.id}`} target="_blank" rel="noopener noreferrer" />}><FileDown />{t("presentations.exportPdf")}</DropdownMenuItem>}
            {item.role === "owner" && <><DropdownMenuSeparator /><DeletePresentationButton menuItem id={item.id} title={item.title} /></>}
          </DropdownMenuContent></DropdownMenu>
        </div>
      </li>)}</ul>}
  </div>;
}
