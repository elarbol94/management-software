"use client";

import { useEffect, useState, useTransition } from "react";
import type { Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
  serializeDocumentSettings,
  type DocumentConstraint,
  type DocumentDiagramSizeMode,
  type DocumentPreflightIssue,
  type DocumentSettingsV1,
} from "../lib/document-settings";
import type { OutlineItem } from "./editor-tools";
import { getDocumentNumberingState } from "./document-extension";
import { formatEuro, proposalSectionSnippet, proposalTable, type ProposalWorkspaceData } from "../lib/proposal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Props = {
  pageId: string;
  editor: Editor;
  settings: DocumentSettingsV1;
  onSettingsChange: (settings: DocumentSettingsV1) => void;
  onApplyTemplate: (settings: DocumentSettingsV1, contentJson: string | null) => void;
  onExport: (format: "docx" | "pdf", inline?: boolean) => void;
  templates: StoredDocumentTemplate[];
  issues: DocumentPreflightIssue[];
  outline: OutlineItem[];
  figureCount: number;
  tableCount: number;
  proposalData: ProposalWorkspaceData;
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
  onApplyTemplate,
  onExport,
  templates,
  issues,
  outline,
  figureCount,
  tableCount,
  proposalData,
  onOpenTypographySettings,
  onClose,
}: Props) {
  const t = useTranslations("wiki.document");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [templateName, setTemplateName] = useState("");
  const [includeContent, setIncludeContent] = useState(false);
  const [applyStarterContent, setApplyStarterContent] = useState(false);
  const [constraintHeading, setConstraintHeading] = useState(outline[0]?.id ?? "");
  const [constraintLimit, setConstraintLimit] = useState("1000");
  const [referenceTarget, setReferenceTarget] = useState(outline[0]?.id ?? "");
  const [fundingProjectId, setFundingProjectId] = useState(proposalData.fundingProjects[0]?.id ?? "");
  const [docxStatus, setDocxStatus] = useState<"idle" | "importing" | "error">("idle");
  const [selectionVersion, setSelectionVersion] = useState(0);

  useEffect(() => {
    const refreshSelection = () => setSelectionVersion((value) => value + 1);
    editor.on("selectionUpdate", refreshSelection);
    editor.on("transaction", refreshSelection);
    return () => {
      editor.off("selectionUpdate", refreshSelection);
      editor.off("transaction", refreshSelection);
    };
  }, [editor]);

  function selectedAncestor(type: string) {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name === type) return { node: $from.node(depth), pos: $from.before(depth) };
    }
    return null;
  }

  const localizedVariableLabels: Record<string, string> = {
    applicant: t("fields.applicant"), programme: t("fields.programme"), projectTitle: t("fields.projectTitle"),
    date: t("fields.date"), fundingPeriod: t("fields.fundingPeriod"), totalBudget: t("fields.totalBudget"),
  };

  const selectedTable = selectedAncestor("markdownTable");
  const selectedHeading = selectedAncestor("heading");
  void selectionVersion;

  // Live-resolved from the document (headings/annexes/figures/tables), so the picker offers
  // every kind of cross-reference target without needing its own separate collection pass.
  const numbering = getDocumentNumberingState(editor);
  const referenceTargets: Array<{ id: string; text: string }> = [
    ...outline.map((item) => ({ id: item.id, text: item.text || t("untitledSection") })),
    ...(numbering?.figures ?? []).map((figure) => ({ id: figure.id, text: numbering?.labels.get(figure.id) ?? figure.caption })),
    ...(numbering?.tables ?? []).map((table) => ({ id: table.id, text: numbering?.labels.get(table.id) ?? table.caption })),
    ...(numbering?.annexes ?? []).map((annex) => ({ id: annex.id, text: annex.title })),
  ];

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

  function insertProposalTable(kind: Parameters<typeof proposalTable>[0], rows?: string[][]) {
    editor.chain().focus().insertContent(proposalTable(kind, rows) as never).run();
  }

  function updateSelectedNode(position: number, attrs: Record<string, unknown>) {
    editor.chain().focus().command(({ tr }) => {
      const node = tr.doc.nodeAt(position);
      if (!node) return false;
      tr.setNodeMarkup(position, undefined, { ...node.attrs, ...attrs });
      return true;
    }).run();
  }

  function insertSnippet(kind: Parameters<typeof proposalSectionSnippet>[0]) {
    editor.chain().focus().insertContent(proposalSectionSnippet(kind) as never).run();
  }

  function insertVariable(key: string) {
    editor.chain().focus().insertContent({ type: "documentVariable", attrs: { key, label: key } }).run();
  }

  async function importDocx(file: File | undefined) {
    if (!file || !editor.isEditable || docxStatus === "importing") return;
    const originalDocument = editor.state.doc;
    setDocxStatus("importing");
    try {
      const form = new FormData(); form.set("file", file); form.set("pageId", pageId);
      const response = await fetch("/api/wiki/docx/import", { method: "POST", body: form });
      if (!response.ok) throw new Error("DOCX import failed");
      const result = await response.json() as { document: object };
      // An import may finish after the author typed more or lost the edit lease.
      if (!editor.isEditable || !editor.state.doc.eq(originalDocument)) throw new Error("Document changed during import");
      editor.commands.setContent(result.document);
      setDocxStatus("idle");
    } catch { setDocxStatus("error"); }
  }

  function applySelectedTemplate() {
    if (!templateId || !editor.isEditable) return;
    const originalDocument = editor.state.doc;
    startTransition(async () => {
      try {
        const result = await applyDocumentTemplate({ pageId, templateId, applyStarterContent });
        if (!editor.isEditable || !editor.state.doc.eq(originalDocument)) throw new Error("Document changed");
        onApplyTemplate(result.settings, result.contentJson);
      } catch { toast.error(t("templateFailed")); }
    });
  }

  function saveTemplate() {
    if (!templateName.trim()) return;
    startTransition(async () => {
      try {
      await savePageAsDocumentTemplate({
        pageId,
        name: templateName.trim(),
        description: "",
        includeContent,
        contentJson: JSON.stringify(editor.getJSON()),
        documentSettingsJson: serializeDocumentSettings(settings),
      });
      setTemplateName("");
      router.refresh();
      } catch { toast.error(t("templateFailed")); }
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
          <div className="rounded-lg border bg-muted/30 px-2.5 py-1.5">
            <Toggle checked={settings.page.numberedHeadings === true} onChange={(numberedHeadings) => patchPage({ numberedHeadings })} label={t("numberedHeadings")} />
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
          <Toggle checked={settings.tables.enabled} onChange={(enabled) => patch({ tables: { ...settings.tables, enabled } })} label={t("tableIndex")} />
          {settings.tables.enabled && <div className="grid gap-2 rounded-lg border bg-muted/35 p-2">
            <Field label={t("tableIndexHeading")}><Input className="h-8" value={settings.tables.heading} onChange={(event) => patch({ tables: { ...settings.tables, heading: event.target.value } })} /></Field>
            <p className="text-[11px] text-muted-foreground">{t("tableIndexCount", { count: tableCount })}</p>
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
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("proposal.snippets")}</p>
          <div className="grid grid-cols-2 gap-2">
            {(["executiveSummary", "objectives", "deliverables", "assumptions", "decision"] as const).map((kind) => <Button key={kind} type="button" size="sm" variant="outline" className="justify-start" onClick={() => insertSnippet(kind)}>{t("proposal.snippet_" + kind)}</Button>)}
          </div>
        </section>

        <section className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("proposal.blocks")}</p>
          <div className="grid grid-cols-2 gap-2">
            {(["budget", "workPackages", "timeline", "risks", "kpis", "generic"] as const).map((kind) => <Button key={kind} type="button" size="sm" variant="outline" className="justify-start" onClick={() => insertProposalTable(kind)}>{t(`proposal.${kind}`)}</Button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["info", "decision", "warning", "assumption"] as const).map((kind) => <Button key={kind} type="button" size="sm" variant="outline" onClick={() => editor.chain().focus().insertContent({ type: "proposalCallout", attrs: { kind, title: t("proposal.callout_" + kind) }, content: [{ type: "paragraph" }] }).run()}>{t("proposal.callout_" + kind)}</Button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => editor.chain().focus().insertContent({ type: "annexMarker", attrs: { annexId: crypto.randomUUID(), title: t("proposal.annex") } }).run()}>{t("proposal.annex")}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => editor.chain().focus().insertContent({ type: "signatureBlock", attrs: { name: settings.cover.author, role: "", location: "", date: settings.cover.date } }).run()}>{t("proposal.signature")}</Button>
          </div>
          {referenceTargets.length > 0 && <div className="flex gap-1">
            <Select value={referenceTarget} onValueChange={(value) => setReferenceTarget(value ?? "")}><SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue placeholder={t("proposal.reference")} /></SelectTrigger><SelectContent>{referenceTargets.map((item, index) => <SelectItem key={`${item.id}-${index}`} value={item.id}>{item.text}</SelectItem>)}</SelectContent></Select>
            <Button type="button" size="sm" variant="outline" disabled={!referenceTarget} onClick={() => editor.chain().focus().insertContent({ type: "crossReference", attrs: { targetId: referenceTarget, label: referenceTargets.find((item) => item.id === referenceTarget)?.text || t("proposal.reference") } }).run()}>{t("proposal.insert")}</Button>
          </div>}
        </section>

        {(selectedTable || selectedHeading) && <section className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("proposal.selection")}</p>
          {selectedTable && <div className="grid gap-2 rounded-lg border bg-muted/25 p-2">
            <Field label={t("proposal.tableCaption")}><Input className="h-8" value={String(selectedTable.node.attrs.caption ?? "")} onChange={(event) => updateSelectedNode(selectedTable.pos, { caption: event.target.value })} placeholder={t("proposal.tableCaptionPlaceholder")} /></Field>
            <Toggle checked={selectedTable.node.attrs.includeInTableIndex !== false} onChange={(includeInTableIndex) => updateSelectedNode(selectedTable.pos, { includeInTableIndex })} label={t("proposal.includeTableIndex")} />
          </div>}
          {selectedHeading && <div className="grid gap-2 rounded-lg border bg-muted/25 p-2">
            <Field label={t("proposal.sectionOwner")}><Input className="h-8" value={String(selectedHeading.node.attrs.sectionOwner ?? "")} onChange={(event) => updateSelectedNode(selectedHeading.pos, { sectionOwner: event.target.value })} /></Field>
            <Field label={t("proposal.sectionStatus")}><Select value={String(selectedHeading.node.attrs.sectionStatus ?? "open")} onValueChange={(value) => value && updateSelectedNode(selectedHeading.pos, { sectionStatus: value })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">{t("proposal.sectionOpen")}</SelectItem><SelectItem value="writing">{t("proposal.sectionWriting")}</SelectItem><SelectItem value="review">{t("proposal.sectionReview")}</SelectItem><SelectItem value="done">{t("proposal.sectionDone")}</SelectItem></SelectContent></Select></Field>
            <Field label={t("proposal.sectionDueDate")}><Input className="h-8" type="date" value={String(selectedHeading.node.attrs.sectionDueDate ?? "")} onChange={(event) => updateSelectedNode(selectedHeading.pos, { sectionDueDate: event.target.value })} /></Field>
          </div>}
        </section>}

        <section className="space-y-2 border-t pt-3">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("proposal.liveData")}</p>
          <Button type="button" size="sm" variant="outline" className="w-full justify-start" disabled={!proposalData.company.name} onClick={() => patch({ cover: { ...settings.cover, organization: proposalData.company.name }, variables: { ...settings.variables, applicant: proposalData.company.name, companyAddress: proposalData.company.address, companyUid: proposalData.company.uid } })}>{t("proposal.company", { name: proposalData.company.name || "—" })}</Button>
          <Button type="button" size="sm" variant="outline" className="w-full justify-start" disabled={!proposalData.people.length} onClick={() => insertProposalTable("team", [[t("proposal.name"), t("proposal.role"), t("proposal.responsibility")], ...proposalData.people.map((person) => [person.name, person.role, ""])])}>{t("proposal.team", { count: proposalData.people.length })}</Button>
          {proposalData.fundingProjects.length > 0 && <div className="flex gap-1">
            <Select value={fundingProjectId} onValueChange={(value) => setFundingProjectId(value ?? "")}><SelectTrigger className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent>{proposalData.fundingProjects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select>
            <Button type="button" size="sm" variant="outline" onClick={() => { const project = proposalData.fundingProjects.find((item) => item.id === fundingProjectId); if (!project) return; patch({ variables: { ...settings.variables, projectTitle: project.name, programme: project.programme, fundingPeriod: [project.start, project.end].filter(Boolean).join(" – ") } }); insertProposalTable("budget", [[t("proposal.project"), t("proposal.programme"), t("proposal.totalCost"), t("proposal.funding")], [project.name, project.programme || project.fundingBody, formatEuro(project.totalCostCents), formatEuro(project.approvedFundingCents)]]); }}>{t("proposal.insert")}</Button>
          </div>}
        </section>

        <section className="space-y-2 border-t pt-3">
          <p className="flex items-center gap-1 text-[11px] font-semibold tracking-wide uppercase"><Variable className="size-3" />{t("variables")}</p>
          {Object.entries(settings.variables).map(([key, value]) => {
            const definition = settings.variableDefinitions[key] ?? { label: key, type: "text", currency: "EUR" as const };
            return <div key={key} className="grid grid-cols-[1fr_auto] gap-1">
              <Field label={localizedVariableLabels[key] ?? definition.label}><Input className="h-8 text-xs" type={definition.type === "date" ? "date" : definition.type === "currency" ? "number" : "text"} step={definition.type === "currency" ? "0.01" : undefined} value={value} placeholder={definition.type === "currency" ? definition.currency : key} onChange={(event) => patch({ variables: { ...settings.variables, [key]: event.target.value } })} /></Field>
              <Button type="button" size="icon" variant="ghost" className="mt-4" aria-label={t("insertVariable", { key })} onClick={() => insertVariable(key)}><Plus /></Button>
            </div>;
          })}
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
          <Toggle checked={applyStarterContent} onChange={setApplyStarterContent} label={t("replaceWithStarterContent")} />
          <Button type="button" size="sm" className="w-full" disabled={pending || !templateId || !editor.isEditable} onClick={applySelectedTemplate}><FilePlus2 />{t("applyTemplate")}</Button>
          <label className="flex h-8 cursor-pointer items-center justify-center rounded-md border px-3 text-xs font-medium hover:bg-accent">
            <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(event) => { void importDocx(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            {docxStatus === "importing" ? t("proposal.importingDocx") : t("proposal.importDocx")}
          </label>
          {docxStatus === "error" && <p className="text-[11px] text-destructive">{t("proposal.importDocxError")}</p>}
          <Button onClick={() => onExport("docx")} type="button" size="sm" variant="outline" className="w-full">{t("proposal.exportDocx")}</Button>

          <Field label={t("templateName")}><Input className="h-8" value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></Field>
          <Toggle checked={includeContent} onChange={setIncludeContent} label={t("includeContent")} />
          <Button type="button" size="sm" variant="outline" className="w-full" disabled={pending || !templateName.trim()} onClick={saveTemplate}><Save />{t("saveTemplate")}</Button>
        </section>
      </TabsContent>

      <TabsContent value="check" className="space-y-2 p-3">
        <section className="space-y-2 rounded-lg border bg-muted/25 p-2.5">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("proposal.submissionRules")}</p>
          <Field label={t("proposal.maxWords")}><Input className="h-8" type="number" min={1} value={settings.submission.maxWords ?? ""} onChange={(event) => patch({ submission: { ...settings.submission, maxWords: event.target.value ? Number(event.target.value) : null } })} /></Field>
          <Toggle checked={settings.submission.requireBudget} onChange={(requireBudget) => patch({ submission: { ...settings.submission, requireBudget } })} label={t("proposal.requireBudget")} />
          <Toggle checked={settings.submission.requireCitations} onChange={(requireCitations) => patch({ submission: { ...settings.submission, requireCitations } })} label={t("proposal.requireCitations")} />
          <Toggle checked={settings.submission.requireSignature} onChange={(requireSignature) => patch({ submission: { ...settings.submission, requireSignature } })} label={t("proposal.requireSignature")} />
          <Field label={t("proposal.requiredAnnexes")}><Input className="h-8" value={settings.submission.requiredAnnexes.join(", ")} onChange={(event) => patch({ submission: { ...settings.submission, requiredAnnexes: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) } })} /></Field>
        </section>
        <section className="space-y-2 rounded-lg border bg-muted/25 p-2.5">
          <p className="text-[11px] font-semibold tracking-wide uppercase">{t("proposal.workflow")}</p>
          <Select value={settings.workflow.status} onValueChange={(value) => value && patch({ workflow: { ...settings.workflow, status: value as DocumentSettingsV1["workflow"]["status"], approvedAt: value === "approved" ? new Date().toISOString() : "" } })}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">{t("proposal.draft")}</SelectItem><SelectItem value="review">{t("proposal.inReview")}</SelectItem><SelectItem value="approved">{t("proposal.approved")}</SelectItem></SelectContent></Select>
          <Field label={t("proposal.reviewer")}><Input className="h-8" value={settings.workflow.reviewer} onChange={(event) => patch({ workflow: { ...settings.workflow, reviewer: event.target.value } })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" variant="outline" disabled={editor.state.selection.empty} onClick={() => editor.chain().focus().setMark("proposalSuggestion", { kind: "insert", author: settings.workflow.reviewer, createdAt: new Date().toISOString() }).run()}>{t("proposal.suggestInsert")}</Button>
            <Button type="button" size="sm" variant="outline" disabled={editor.state.selection.empty} onClick={() => editor.chain().focus().setMark("proposalSuggestion", { kind: "delete", author: settings.workflow.reviewer, createdAt: new Date().toISOString() }).run()}>{t("proposal.suggestDelete")}</Button>
            <Button type="button" size="sm" variant="outline" disabled={editor.state.selection.empty} onClick={() => editor.chain().focus().unsetMark("proposalSuggestion", { extendEmptyMarkRange: true }).run()}>{t("proposal.acceptChange")}</Button>
            <Button type="button" size="sm" variant="outline" disabled={editor.state.selection.empty} onClick={() => { if (editor.isActive("proposalSuggestion", { kind: "insert" })) editor.chain().focus().deleteSelection().run(); else editor.chain().focus().unsetMark("proposalSuggestion", { extendEmptyMarkRange: true }).run(); }}>{t("proposal.rejectChange")}</Button>
          </div>

        </section>

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
          : <Button onClick={() => onExport("pdf", true)} className="mt-2 w-full">
              <FilePlus2 />{t("previewPdf")}
            </Button>}
      </TabsContent>
    </Tabs>
  </aside>;
}
