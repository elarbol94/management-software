"use client";
import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { documentFigures } from "../lib/figure";
import { getDocumentNumberingState } from "./document-extension";
import { useFigures } from "./figure-library";

export function FigureReferencePicker({ editor, open, onOpenChange, insert }: { editor: Editor; open: boolean; onOpenChange: (open: boolean) => void; insert: (targetId: string, label: string) => void }) {
  const t = useTranslations("wiki.figures");
  const [search, setSearch] = useState("");
  const library = useFigures();
  const figures = documentFigures(editor.getJSON());
  const numbering = getDocumentNumberingState(editor);
  const targets = [
    ...figures.map((figure) => ({ id: figure.nodeId, text: `${numbering?.labels.get(figure.nodeId) || figure.number}: ${figure.caption}`, src: library?.manifest.assets.find((asset) => asset.id === figure.assetId)?.src || figure.src })),
    ...(numbering?.headings ?? []).map((heading) => ({ id: heading.id, text: heading.text, src: "" })),
    ...(numbering?.tables ?? []).map((table) => ({ id: table.id, text: `${numbering?.labels.get(table.id)}: ${table.caption}`, src: "" })),
    ...(numbering?.annexes ?? []).map((annex) => ({ id: annex.id, text: annex.title, src: "" })),
  ].filter((item) => item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{t("insertReference")}</DialogTitle></DialogHeader>
    <Input autoFocus aria-label={t("searchReference")} placeholder={t("searchReference")} value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="max-h-80 space-y-1 overflow-auto">{targets.length ? targets.map((item) => <button key={item.id} type="button" className="flex w-full items-center gap-3 rounded border p-2 text-left text-sm hover:bg-muted" onClick={() => { insert(item.id, numbering?.labels.get(item.id) || item.text); onOpenChange(false); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {item.src && <img src={item.src} alt="" className="h-12 w-16 rounded bg-white object-contain" />}<span>{item.text}</span>
    </button>) : <p className="p-4 text-sm text-muted-foreground">{t("noReferences")}</p>}</div>
  </DialogContent></Dialog>;
}
