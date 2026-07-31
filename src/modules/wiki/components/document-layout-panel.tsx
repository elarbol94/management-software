"use client";

import { useState, useTransition } from "react";
import type { Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Columns2,
  FilePlus2,
  ListTree,
  Plus,
  Save,
  ScissorsLineDashed,
  Settings2,
  Variable,
  X,
} from "lucide-react";
import { applyDocumentTemplate, savePageAsDocumentTemplate } from "../document-actions";
import type { StoredDocumentTemplate } from "../document-queries";
import {
  DOCUMENT_DIAGRAM_SIZE_MODES,
  type DocumentConstraint,
  type DocumentDiagramSizeMode,
  type DocumentPreflightIssue,
  type DocumentSettingsV1,
} from "../lib/document-settings";
import type { OutlineItem } from "./editor-tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  pageId: string;
  editor: Editor;
  settings: DocumentSettingsV1;
  onSettingsChange: (settings: DocumentSettingsV1) => void;
  templates: StoredDocumentTemplate[];
  issues: DocumentPreflightIssue[];
  outline: OutlineItem[];
  figureCount: number;
  onOpenTypographySettings: () => void;
  onClose: () => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
    <span>{label}</span>
    {children}
  </label>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-xs">
    <span>{label}</span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-indigo-600" />
  </label>;
}

export function DocumentLayoutPanel({
  pageId,
  editor,
  settings,
  onSettingsChange,
  templates,
  issues,
  outline,
  figureCount,
  onOpenTypographySettings,
  onClose,
}: Props) {
  const t = useTranslations("wiki.document");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [templateName, setTemplateName] = useState("");
  const [includeContent, setIncludeContent] = useState(false);
  const [constraintHeading, setConstraintHeading] = useState(outline[0]?.id ?? "");
  const [constraintLimit, setConstraintLimit] = useState("1000");

  const effectiveConstraintHeading = outline.some((item) => item.id === constraintHeading)
    ? constraintHeading
    : outline[0]?.id ?? "";

  function patch(next: Partial<DocumentSettingsV1>) {
    onSettingsChange({ ...settings, ...next });
  }

  function patchPage(next: Partial<DocumentSettingsV1["page"]>) {
    patch({ page: { ...settings.page, ...next } });
  }

  function patchMargins(key: keyof DocumentSettingsV1["page"]["marginsMm"], value: number) {
    patchPage({ marginsMm: { ...settings.page.marginsMm, [key]: value } });
  }

  function insertVariable(key: string) {
    editor.chain().focus().insertContent({ type: "documentVariable", attrs: { key, label: key } }).run();
  }

  function applySelectedTemplate() {
    if (!templateId) return;
    startTransition(async () => {
      await applyDocumentTemplate({ pageId, templateId, applyStarterContent: true });
      location.reload();
    });
  }

  function saveTemplate() {
    if (!templateName.trim()) return;
    startTransition(async () => {
      await savePageAsDocumentTemplate({
        pageId,
        name: templateName.trim(),
        description: "",
        includeContent,
      });
      setTemplateName("");
      router.refresh();
    });
  }

  function addConstraint() {
    const heading = outline.find((item) => item.id === effectiveConstraintHeading);
    const max = Number.parseInt(constraintLimit, 10);
    if (!heading || !Number.isFinite(max) || max < 1) return;
    const constraint: DocumentConstraint = {
      id: crypto.randomUUID(),
      headingId: heading.id,
      label: heading.text || t("untitledSection"),
      required: true,
      metric: "characters",
      max,
    };
    patch({ constraints: [...settings.constraints, constraint] });
  }

  return <aside data-testid="document-layout-panel" className="sticky top-14 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-xl border bg-background/96 shadow-sm">
    <div className="flex items-start gap-2 border-b px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{t("panelTitle")}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{t("panelDescription")}</p>
      </div>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("hideLayout")} title={t("hideLayout")} onClick={onClose}>
        <X />
      </Button>
    </div>
    <Tabs defaultValue="page" className="gap-0">
      <TabsList className="mx-2 mt-2 grid grid-cols-3">
        <TabsTrigger value="page">{t("tabs.page")}</TabsTrigger>
        <TabsTrigger value="content">{t("tabs.content")}</TabsTrigger>
        <TabsTrigger value="check">{t("tabs.check")}</TabsTrigger>
      </TabsList>

      <TabsContent value="page" className="space-y-4 p-3">
        <section className="space-y-2">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("page")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("pageSize")}>
              <Select value={settings.page.size} onValueChange={(value) => value && patchPage({ size: value as DocumentSettingsV1["page"]["size"] })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="A4">A4</SelectItem><SelectItem value="Letter">Letter</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label={t("orientation")}>
              <Select value={settings.page.orientation} onValueChange={(value) => value && patchPage({ orientation: value as DocumentSettingsV1["page"]["orientation"] })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="portrait">{t("portrait")}</SelectItem><SelectItem value="landscape">{t("landscape")}</SelectItem></SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["top", "right", "bottom", "left"] as const).map((side) => <Field key={side} label={t(`margin.${side}`)}>
              <Input className="h-8" type="number" min={8} max={50} value={settings.page.marginsMm[side]} onChange={(event) => patchMargins(side, Number(event.target.value))} />
            </Field>)}
          </div>
          <div className="rounded-lg border bg-muted/30 px-2.5 py-1.5">
            <Toggle checked={settings.page.showMarginGuides} onChange={(showMarginGuides) => patchPage({ showMarginGuides })} label={t("showMarginGuides")} />
          </div>
        </section>

        <section className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("globalTypography")}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">{t("globalTypographyDescription")}</p>
          <Button type="button" size="sm" variant="outline" className="w-full justify-start" onClick={onOpenTypographySettings}>
            <Settings2 />
            {t("openGlobalTypography")}
          </Button>
        </section>

        <section className="space-y-2 border-t pt-3">
          <Toggle checked={settings.cover.enabled} onChange={(enabled) => patch({ cover: { ...settings.cover, enabled } })} label={t("cover")} />
          {settings.cover.enabled && <>
            <Field label={t("eyebrow")}><Input className="h-8" value={settings.cover.eyebrow} onChange={(event) => patch({ cover: { ...settings.cover, eyebrow: event.target.value } })} /></Field>
            <Field label={t("subtitle")}><Input className="h-8" value={settings.cover.subtitle} onChange={(event) => patch({ cover: { ...settings.cover, subtitle: event.target.value } })} /></Field>
            <Field label={t("author")}><Input className="h-8" value={settings.cover.author} onChange={(event) => patch({ cover: { ...settings.cover, author: event.target.value } })} /></Field>
            <Field label={t("organization")}><Input className="h-8" value={settings.cover.organization} onChange={(event) => patch({ cover: { ...settings.cover, organization: event.target.value } })} /></Field>
            <Field label={t("date")}><Input className="h-8" value={settings.cover.date} onChange={(event) => patch({ cover: { ...settings.cover, date: event.target.value } })} /></Field>
          </>}
          <Toggle checked={settings.header.enabled} onChange={(enabled) => patch({ header: { ...settings.header, enabled } })} label={t("header")} />
          {settings.header.enabled && <div className="grid gap-2">
            <Field label={t("left")}><Input className="h-8" value={settings.header.left} onChange={(event) => patch({ header: { ...settings.header, left: event.target.value } })} /></Field>
            <Field label={t("center")}><Input className="h-8" value={settings.header.center} onChange={(event) => patch({ header: { ...settings.header, center: event.target.value } })} /></Field>
            <Field label={t("right")}><Input className="h-8" value={settings.header.right} onChange={(event) => patch({ header: { ...settings.header, right: event.target.value } })} /></Field>
          </div>}
          <Toggle checked={settings.footer.enabled} onChange={(enabled) => patch({ footer: { ...settings.footer, enabled } })} label={t("footer")} />
          {settings.footer.enabled && <div className="grid gap-2">
            <Field label={t("left")}><Input className="h-8" value={settings.footer.left} onChange={(event) => patch({ footer: { ...settings.footer, left: event.target.value } })} /></Field>
            <Field label={t("center")}><Input className="h-8" value={settings.footer.center} onChange={(event) => patch({ footer: { ...settings.footer, center: event.target.value } })} /></Field>
            <Field label={t("right")}><Input className="h-8" value={settings.footer.right} onChange={(event) => patch({ footer: { ...settings.footer, right: event.target.value } })} /></Field>
          </div>}
          <Toggle checked={settings.footer.pageNumbers} onChange={(pageNumbers) => patch({ footer: { ...settings.footer, pageNumbers } })} label={t("pageNumbers")} />
          {settings.footer.pageNumbers && <Field label={t("pageNumberStart")}><Input className="h-8" type="number" min={0} value={settings.footer.pageNumberStart} onChange={(event) => patch({ footer: { ...settings.footer, pageNumberStart: Number(event.target.value) } })} /></Field>}
          <Toggle checked={settings.bibliography.enabled} onChange={(enabled) => patch({ bibliography: { ...settings.bibliography, enabled } })} label={t("bibliography")} />
          {settings.bibliography.enabled && <Field label={t("bibliographyHeading")}><Input className="h-8" value={settings.bibliography.heading} onChange={(event) => patch({ bibliography: { ...settings.bibliography, heading: event.target.value } })} /></Field>}
          <Toggle checked={settings.figures.enabled} onChange={(enabled) => patch({ figures: { ...settings.figures, enabled } })} label={t("figureIndex")} />
          {settings.figures.enabled && <div className="grid gap-2 rounded-lg border bg-muted/35 p-2">
            <Field label={t("figureIndexHeading")}><Input className="h-8" value={settings.figures.heading} onChange={(event) => patch({ figures: { ...settings.figures, heading: event.target.value } })} /></Field>
            <p className="text-[11px] text-muted-foreground">{t("figureIndexCount", { count: figureCount })}</p>
          </div>}
          <Toggle checked={settings.diagrams.matchFont} onChange={(matchFont) => patch({ diagrams: { ...settings.diagrams, matchFont } })} label={t("diagramMatchFont")} />
          <Toggle checked={settings.diagrams.matchColor} onChange={(matchColor) => patch({ diagrams: { ...settings.diagrams, matchColor } })} label={t("diagramMatchColor")} />
          <Field label={t("diagramSizeMode")}>
            <Select value={settings.diagrams.sizeMode} onValueChange={(value) => patch({ diagrams: { ...settings.diagrams, sizeMode: (value ?? "off") as DocumentDiagramSizeMode } })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_DIAGRAM_SIZE_MODES.map((mode) => <SelectItem key={mode} value={mode}>{t(`diagramSizeMode_${mode}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {settings.diagrams.sizeMode !== "off" && <div className="grid gap-2 rounded-lg border bg-muted/35 p-2">
            <Field label={t("diagramSizeScale")}>
              <Input className="h-8" type="number" min={0.25} max={4} step={0.05} value={settings.diagrams.sizeScale} onChange={(event) => patch({ diagrams: { ...settings.diagrams, sizeScale: Number(event.target.value) } })} />
            </Field>
            <p className="text-[11px] text-muted-foreground">{t(settings.diagrams.sizeMode === "rewrite" ? "diagramRewriteHint" : "diagramSizeScaleHint")}</p>
          </div>}
        </section>
      </TabsContent>

      <TabsContent value="content" className="space-y-4 p-3">
        <section className="space-y-2">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("insert")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" variant="outline" className="justify-start" onClick={() => editor.chain().focus().insertContent({ type: "pageBreak" }).run()}><ScissorsLineDashed />{t("pageBreak")}</Button>
            <Button type="button" size="sm" variant="outline" className="justify-start" onClick={() => editor.chain().focus().insertContent({ type: "tableOfContents", attrs: { title: t("contents"), maxLevel: 3 } }).run()}><ListTree />{t("contents")}</Button>
            <Button type="button" size="sm" variant="outline" className="col-span-2 justify-start" onClick={() => editor.chain().focus().insertContent({ type: "layoutSection", attrs: { columns: 2, gapMm: 8 }, content: [{ type: "paragraph" }, { type: "paragraph" }] }).run()}><Columns2 />{t("twoColumns")}</Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" variant={editor.isActive({ keepWithNext: true }) ? "secondary" : "outline"} onClick={() => editor.chain().focus().updateAttributes(editor.state.selection.$from.parent.type.name, { keepWithNext: !editor.isActive({ keepWithNext: true }) }).run()}>{t("keepWithNext")}</Button>
            <Button type="button" size="sm" variant={editor.isActive({ keepTogether: true }) ? "secondary" : "outline"} onClick={() => editor.chain().focus().updateAttributes(editor.state.selection.$from.parent.type.name, { keepTogether: !editor.isActive({ keepTogether: true }) }).run()}>{t("keepTogether")}</Button>
          </div>
        </section>

        <section className="space-y-2 border-t pt-3">
          <p className="flex items-center gap-1 text-[11px] font-semibold tracking-wide uppercase"><Variable className="size-3" />{t("variables")}</p>
          {Object.entries(settings.variables).map(([key, value]) => <div key={key} className="grid grid-cols-[1fr_auto] gap-1">
            <Input className="h-8 text-xs" value={value} placeholder={key} onChange={(event) => patch({ variables: { ...settings.variables, [key]: event.target.value } })} />
            <Button type="button" size="icon" variant="ghost" aria-label={t("insertVariable", { key })} onClick={() => insertVariable(key)}><Plus /></Button>
          </div>)}
        </section>

        <section className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("constraints")}</p>
          <Select value={effectiveConstraintHeading} onValueChange={(value) => setConstraintHeading(value ?? "")}>
            <SelectTrigger className="h-8"><SelectValue placeholder={t("chooseSection")} /></SelectTrigger>
            <SelectContent>{outline.map((item) => <SelectItem key={`${item.id}-${item.position}`} value={item.id}>{item.text || t("untitledSection")}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-1">
            <Input className="h-8" type="number" min={1} value={constraintLimit} onChange={(event) => setConstraintLimit(event.target.value)} />
            <Button type="button" size="sm" variant="outline" onClick={addConstraint}><Plus />{t("addLimit")}</Button>
          </div>
          {settings.constraints.map((constraint) => <div key={constraint.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-[11px]">
            <span className="min-w-0 flex-1 truncate">{constraint.label} · max. {constraint.max}</span>
            <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => patch({ constraints: settings.constraints.filter((item) => item.id !== constraint.id) })}>×</button>
          </div>)}
        </section>

        <section className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("templates")}</p>
          <Select value={templateId} onValueChange={(value) => setTemplateId(value ?? "")}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" size="sm" className="w-full" disabled={pending || !templateId} onClick={applySelectedTemplate}><FilePlus2 />{t("applyTemplate")}</Button>
          <Field label={t("templateName")}><Input className="h-8" value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></Field>
          <Toggle checked={includeContent} onChange={setIncludeContent} label={t("includeContent")} />
          <Button type="button" size="sm" variant="outline" className="w-full" disabled={pending || !templateName.trim()} onClick={saveTemplate}><Save />{t("saveTemplate")}</Button>
        </section>
      </TabsContent>

      <TabsContent value="check" className="space-y-2 p-3">
        <div className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${issues.some((issue) => issue.severity === "error") ? "border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" : "border-emerald-200 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100"}`}>
          {issues.length ? <AlertTriangle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
          <span>{issues.length ? t("issuesCount", { count: issues.length }) : t("ready")}</span>
        </div>
        {issues.map((issue) => <div key={issue.id} className="rounded-lg border p-2 text-[11px] leading-4">
          <div className="flex items-start gap-2">
            {issue.severity === "error" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : <BookOpen className="mt-0.5 size-3.5 shrink-0 text-amber-600" />}
            <span>{issue.message}</span>
          </div>
        </div>)}
        {issues.some((issue) => issue.severity === "error")
          ? <Button type="button" className="mt-2 w-full" disabled><FilePlus2 />{t("previewPdf")}</Button>
          : <Button nativeButton={false} render={<a href={`/api/wiki/pages/${pageId}/export?format=pdf&disposition=inline`} target="_blank" rel="noreferrer" />} className="mt-2 w-full">
              <FilePlus2 />{t("previewPdf")}
            </Button>}
      </TabsContent>
    </Tabs>
  </aside>;
}
