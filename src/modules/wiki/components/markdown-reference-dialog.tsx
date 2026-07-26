"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type MarkdownReferenceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const groups = [
  {
    key: "inline",
    items: [
      ["**fett**", "bold"],
      ["*kursiv*", "italic"],
      ["~~durchgestrichen~~", "strikethrough"],
      ["`code`", "code"],
      ["[Titel](https://example.com)", "link"],
      ["==hervorgehoben==", "highlight"],
      ["H~2~O", "subscript"],
      ["X^2^", "superscript"],
      ["->  <-  -->  <->", "arrows"],
      [":joy:", "emoji"],
      ["[^1]", "footnoteReference"],
    ],
  },
  {
    key: "blocks",
    items: [
      ["# Überschrift\n## Überschrift\n### Überschrift", "headings"],
      ["### Überschrift {#eigene-id}", "headingId"],
      ["> Zitat", "blockquote"],
      ["- Eintrag\n* Eintrag", "bulletList"],
      ["1. Erster Eintrag", "orderedList"],
      ["- [ ] Offen\n- [x] Erledigt", "taskList"],
      ["---", "divider"],
      ["```\nCode\n```", "fencedCode"],
    ],
  },
  {
    key: "structured",
    items: [
      ["![Alternativtext](bild.jpg)", "image"],
      ["| Syntax | Beschreibung |\n| --- | --- |", "table"],
      ["Begriff\n: Definition", "definitionList"],
      ["[^1]: Fußnotentext", "footnoteDefinition"],
    ],
  },
] as const;

export function MarkdownReferenceDialog({ open, onOpenChange }: MarkdownReferenceDialogProps) {
  const t = useTranslations("wiki");

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-testid="markdown-reference-dialog" className="max-h-[min(42rem,calc(100vh-2rem))] overflow-y-auto p-0 sm:max-w-3xl" onOverlayPointerDownCapture={() => onOpenChange(false)}>
      <DialogHeader className="sticky top-0 z-10 border-b bg-popover px-5 py-4 pr-12">
        <DialogTitle>{t("markdownHelp.title")}</DialogTitle>
        <DialogDescription>{t("markdownHelp.description")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-6 px-5 pb-6">
        {groups.map((group) => <section key={group.key} aria-labelledby={`markdown-${group.key}`}>
          <h3 id={`markdown-${group.key}`} className="mb-2 text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase dark:text-indigo-400">{t(`markdownHelp.groups.${group.key}`)}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.items.map(([syntax, label]) => <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(7.5rem,0.8fr)] items-center gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
              <code className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{syntax}</code>
              <span className="text-xs leading-4 text-muted-foreground">{t(`markdownHelp.items.${label}`)}</span>
            </div>)}
          </div>
        </section>)}
      </div>
    </DialogContent>
  </Dialog>;
}
