"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { formatCents, parseAmountToCents } from "@/lib/money";
import type { FundingProjectControl } from "@/modules/funding/queries";
import {
  deleteFundingBookingAllocation,
  deleteFundingBudgetItem,
  deleteFundingDisbursement,
  deleteFundingFinancingSource,
  upsertFundingBookingAllocation,
  upsertFundingBudgetItem,
  upsertFundingDisbursement,
  upsertFundingFinancingSource,
  type FundingBookingAllocationInput,
  type FundingBudgetItemInput,
  type FundingDisbursementInput,
  type FundingFinancingSourceInput,
} from "@/modules/funding/actions";
import { FundingProjectDialog } from "./project-dialog";
import { StatusBadge } from "./funding-projects-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EvidencePanel } from "@/modules/wiki/components/evidence-panel";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

type BudgetItem = FundingProjectControl["budgetItems"][number];
type FinancingSource = FundingProjectControl["financingSources"][number];
type Disbursement = FundingProjectControl["disbursements"][number];

export function FundingProjectControlView({
  control,
  templates,
}: {
  control: FundingProjectControl;
  templates: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("fundingProjects");
  const locale = useLocale();
  const router = useRouter();
  const { project, metrics } = control;
  const [projectOpen, setProjectOpen] = useState(false);
  const [budgetItem, setBudgetItem] = useState<BudgetItem | null | undefined>();
  const [source, setSource] = useState<FinancingSource | null | undefined>();
  const [disbursement, setDisbursement] = useState<Disbursement | null | undefined>();
  const [allocationOpen, setAllocationOpen] = useState(false);

  async function remove(action: () => Promise<void>) {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await action();
      router.refresh();
    } catch {
      toast.error(t("saveError"));
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-2" render={<Link href="/accounting/funding-projects" />}>
            <ArrowLeft className="size-4" /> {t("backToList")}
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
            <StatusBadge status={project.status} label={t(`status.${project.status}`)} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.fundingBody} · {project.programName || project.templateName || t("customTemplate")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setProjectOpen(true)}>
          <Pencil className="size-4" /> {t("editProject")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("summary.totalCost")} value={formatCents(metrics.totalProjectCostCents, locale)} />
        <Metric label={t("summary.eligible")} value={formatCents(metrics.totalEligibleCostCents, locale)} />
        <Metric label={t("summary.requested")} value={formatCents(metrics.requestedGrantCents, locale)} />
        <Metric label={t("summary.financingGap")} value={formatCents(metrics.financingGapCents, locale)} risk={metrics.financingGapCents > 0} />
      </div>

      <Tabs defaultValue="project" className="min-w-0 gap-5">
        <TabsList variant="line" className="max-w-full overflow-x-auto" aria-label={t("sections.label")}>
          <TabsTrigger value="project">{t("sections.project")}</TabsTrigger>
          <TabsTrigger value="cost-plan">{t("sections.costPlan")}</TabsTrigger>
          <TabsTrigger value="financing">{t("sections.financing")}</TabsTrigger>
          <TabsTrigger value="settlement">{t("sections.settlement")}</TabsTrigger>
        </TabsList>

        <TabsContent value="project" className="grid gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">{t("sections.project")}</CardTitle></CardHeader>
            <CardContent className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label={t("fields.template")} value={project.templateName || t("customTemplate")} />
              <Fact label={t("fields.programName")} value={project.programName} />
              <Fact label={t("fields.fundingNumber")} value={project.fundingNumber} />
              <Fact label={t("fields.submissionDeadline")} value={formatDate(project.submissionDeadline, locale)} />
              <Fact label={t("fields.plannedSubmission")} value={formatDate(project.plannedSubmissionDate, locale)} />
              <Fact label={t("fields.projectPeriod")} value={`${formatDate(project.projectStart, locale)} – ${formatDate(project.projectEnd, locale)}`} />
              <Fact label={t("fields.fundingRate")} value={`${(project.fundingRateBasisPoints / 100).toLocaleString(locale)} %`} />
              <Fact label={t("fields.fundingCap")} value={project.fundingCapCents === null ? "—" : formatCents(project.fundingCapCents, locale)} />
              <Fact label={t("summary.maximumGrant")} value={formatCents(metrics.maximumGrantCents, locale)} />
              <Fact label={t("fields.contact")} value={[project.contactName, project.contactEmail].filter(Boolean).join(" · ")} />
              <Fact label={t("fields.vatDeductible")} value={project.vatDeductible ? t("yes") : t("no")} />
              <Fact label={t("fields.deMinimis")} value={project.deMinimisRelevant ? t("yes") : t("no")} />
              <Fact label={t("fields.otherAid")} value={formatCents(project.otherAidCents, locale)} />
              <div className="sm:col-span-2 lg:col-span-3"><Fact label={t("fields.notes")} value={project.notes} /></div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">{t("templateDisclaimer")}</p>
        </TabsContent>

        <TabsContent value="cost-plan">
          <Card>
            <CardHeader className="flex-row items-center justify-between border-b">
              <div>
                <CardTitle className="text-base">{t("sections.costPlan")}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t("costPlanDescription")}</p>
              </div>
              <Button size="sm" onClick={() => setBudgetItem(null)}><Plus className="size-4" /> {t("budget.add")}</Button>
            </CardHeader>
            <CardContent className="p-0">
              {control.budgetItems.length === 0 ? <Empty text={t("budget.empty")} /> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t("budget.costType")}</TableHead><TableHead>{t("budget.description")}</TableHead><TableHead>{t("budget.workPackage")}</TableHead><TableHead>{t("budget.supplier")}</TableHead><TableHead>{t("budget.quantity")}</TableHead><TableHead>{t("budget.month")}</TableHead><TableHead className="text-right">{t("budget.total")}</TableHead><TableHead className="text-right">{t("budget.eligible")}</TableHead><TableHead><span className="sr-only">{t("actions")}</span></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{control.budgetItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.costType === "program_specific" && item.customCostType ? item.customCostType : t(`costType.${item.costType}`)}</TableCell>
                      <TableCell><div className="max-w-64 whitespace-normal font-medium">{item.description}</div></TableCell>
                      <TableCell>{item.workPackage || "—"}</TableCell><TableCell>{item.supplierOrPerson || "—"}</TableCell>
                      <TableCell className="tabular-nums">{(item.quantityThousandths / 1000).toLocaleString(locale)} {item.unitLabel}</TableCell>
                      <TableCell>{item.plannedMonth || "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCents(item.totalCents, locale)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCents(item.eligibleAmountCents, locale)}</TableCell>
                      <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon-xs" onClick={() => setBudgetItem(item)} aria-label={t("edit")}><Pencil /></Button><Button variant="ghost" size="icon-xs" onClick={() => remove(() => deleteFundingBudgetItem(item.id))} aria-label={t("delete")}><Trash2 /></Button></div></TableCell>
                    </TableRow>
                  ))}</TableBody>
                  <TableFooter><TableRow><TableCell colSpan={6}>{t("total")}</TableCell><TableCell className="text-right tabular-nums">{formatCents(metrics.totalProjectCostCents, locale)}</TableCell><TableCell className="text-right tabular-nums">{formatCents(metrics.totalEligibleCostCents, locale)}</TableCell><TableCell /></TableRow></TableFooter>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="financing" className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={t("summary.requiredOwnFunds")} value={formatCents(metrics.requiredOwnFundsCents, locale)} />
            <Metric label={t("summary.financingTotal")} value={formatCents(metrics.financingTotalCents, locale)} />
            <Metric label={t("summary.financingGap")} value={formatCents(metrics.financingGapCents, locale)} risk={metrics.financingGapCents > 0} />
            <Metric label={t("summary.approved")} value={formatCents(project.approvedFundingCents, locale)} />
          </div>
          <Card>
            <CardHeader className="flex-row items-center justify-between border-b"><CardTitle className="text-base">{t("financing.sources")}</CardTitle><Button size="sm" onClick={() => setSource(null)}><Plus /> {t("financing.addSource")}</Button></CardHeader>
            <CardContent className="p-0">{control.financingSources.length === 0 ? <Empty text={t("financing.emptySources")} /> : <Table>
              <TableHeader><TableRow><TableHead>{t("financing.sourceType")}</TableHead><TableHead>{t("financing.label")}</TableHead><TableHead className="text-right">{t("financing.amount")}</TableHead><TableHead><span className="sr-only">{t("actions")}</span></TableHead></TableRow></TableHeader>
              <TableBody>{control.financingSources.map((item) => <TableRow key={item.id}><TableCell>{t(`sourceType.${item.sourceType}`)}</TableCell><TableCell>{item.label || "—"}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatCents(item.amountCents, locale)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon-xs" onClick={() => setSource(item)} aria-label={t("edit")}><Pencil /></Button><Button variant="ghost" size="icon-xs" onClick={() => remove(() => deleteFundingFinancingSource(item.id))} aria-label={t("delete")}><Trash2 /></Button></div></TableCell></TableRow>)}</TableBody>
            </Table>}</CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between border-b"><CardTitle className="text-base">{t("financing.disbursements")}</CardTitle><Button size="sm" variant="outline" onClick={() => setDisbursement(null)}><Plus /> {t("financing.addDisbursement")}</Button></CardHeader>
            <CardContent className="p-0">{control.disbursements.length === 0 ? <Empty text={t("financing.emptyDisbursements")} /> : <Table>
              <TableHeader><TableRow><TableHead>{t("financing.label")}</TableHead><TableHead>{t("financing.plannedDate")}</TableHead><TableHead>{t("fields.status")}</TableHead><TableHead className="text-right">{t("financing.amount")}</TableHead><TableHead><span className="sr-only">{t("actions")}</span></TableHead></TableRow></TableHeader>
              <TableBody>{control.disbursements.map((item) => <TableRow key={item.id}><TableCell>{item.label}</TableCell><TableCell>{formatDate(item.plannedDate, locale)}</TableCell><TableCell><Badge variant={item.status === "received" ? "default" : "secondary"}>{t(`disbursementStatus.${item.status}`)}</Badge></TableCell><TableCell className="text-right font-medium tabular-nums">{formatCents(item.amountCents, locale)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon-xs" onClick={() => setDisbursement(item)} aria-label={t("edit")}><Pencil /></Button><Button variant="ghost" size="icon-xs" onClick={() => remove(() => deleteFundingDisbursement(item.id))} aria-label={t("delete")}><Trash2 /></Button></div></TableCell></TableRow>)}</TableBody>
            </Table>}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settlement" className="grid gap-4">
          {control.warningCodes.length > 0 && <div className="grid gap-2" aria-label={t("warnings.title")}>
            {control.warningCodes.map((warning) => <Alert key={warning} variant={warning === "project_end_near" ? "default" : "destructive"}><AlertTriangle /><AlertTitle>{t(`warnings.${warning}.title`)}</AlertTitle><AlertDescription>{t(`warnings.${warning}.description`)}</AlertDescription></Alert>)}
          </div>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label={t("summary.plan")} value={formatCents(metrics.totalProjectCostCents, locale)} />
            <Metric label={t("summary.actual")} value={formatCents(metrics.totalActualCents, locale)} />
            <Metric label={t("summary.evidence")} value={`${metrics.evidenceComplete}/${metrics.evidenceTotal}`} />
          </div>
          <Card>
            <CardHeader className="flex-row items-center justify-between border-b"><div><CardTitle className="text-base">{t("sections.settlement")}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{t("settlement.description")}</p></div><Button size="sm" onClick={() => setAllocationOpen(true)} disabled={control.budgetItems.length === 0}><Plus /> {t("settlement.addActual")}</Button></CardHeader>
            <CardContent className="p-0">{control.budgetItems.length === 0 ? <Empty text={t("settlement.empty")} /> : <Table>
              <TableHeader><TableRow><TableHead>{t("budget.description")}</TableHead><TableHead className="text-right">{t("summary.plan")}</TableHead><TableHead className="text-right">{t("summary.actual")}</TableHead><TableHead className="text-right">{t("summary.variance")}</TableHead><TableHead>{t("summary.evidence")}</TableHead></TableRow></TableHeader>
              <TableBody>{control.budgetItems.map((item) => <TableRow key={item.id}><TableCell><div className="max-w-80 whitespace-normal font-medium">{item.description}</div></TableCell><TableCell className="text-right tabular-nums">{formatCents(item.totalCents, locale)}</TableCell><TableCell className="text-right tabular-nums">{formatCents(item.actualCents, locale)}</TableCell><TableCell className={`text-right font-medium tabular-nums ${item.varianceCents < 0 ? "text-destructive" : ""}`}>{formatCents(item.varianceCents, locale)}</TableCell><TableCell>{item.evidenceTotal === 0 ? <Badge variant="secondary">{t("evidence.none")}</Badge> : item.evidenceComplete === item.evidenceTotal ? <Badge><CheckCircle2 /> {t("evidence.complete")}</Badge> : <Badge variant="destructive"><FileCheck2 /> {item.evidenceComplete}/{item.evidenceTotal}</Badge>}</TableCell></TableRow>)}</TableBody>
            </Table>}</CardContent>
          </Card>
          {control.allocations.length > 0 && <Card>
            <CardHeader><CardTitle className="text-base">{t("settlement.bookings")}</CardTitle></CardHeader>
            <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>{t("settlement.bookingDate")}</TableHead><TableHead>{t("budget.description")}</TableHead><TableHead>{t("settlement.evidenceStatus")}</TableHead><TableHead className="text-right">{t("summary.actual")}</TableHead><TableHead><span className="sr-only">{t("actions")}</span></TableHead></TableRow></TableHeader><TableBody>{control.allocations.map((allocation) => <TableRow key={allocation.id}><TableCell>{formatDate(allocation.bookingDate, locale)}</TableCell><TableCell>{allocation.description || control.budgetItems.find((item) => item.id === allocation.budgetItemId)?.description}</TableCell><TableCell><EvidenceBadge status={allocation.evidenceStatus} label={t(`evidence.`)} /><div className="mt-2 min-w-72"><EvidencePanel targetType="fundingBookingAllocation" targetId={allocation.id} compact /></div></TableCell><TableCell className="text-right tabular-nums">{formatCents(allocation.actualAmountCents, locale)}</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon-xs" onClick={() => remove(() => deleteFundingBookingAllocation(allocation.id))} aria-label={t("delete")}><Trash2 /></Button></TableCell></TableRow>)}</TableBody></Table></CardContent>
          </Card>}
        </TabsContent>
      </Tabs>

      <EvidencePanel targetType="fundingProject" targetId={project.id} />

      <FundingProjectDialog open={projectOpen} onOpenChange={setProjectOpen} project={project} templates={templates} />
      <BudgetItemDialog open={budgetItem !== undefined} onOpenChange={(open) => !open && setBudgetItem(undefined)} item={budgetItem ?? null} projectId={project.id} />
      <FinancingSourceDialog open={source !== undefined} onOpenChange={(open) => !open && setSource(undefined)} item={source ?? null} projectId={project.id} />
      <DisbursementDialog open={disbursement !== undefined} onOpenChange={(open) => !open && setDisbursement(undefined)} item={disbursement ?? null} projectId={project.id} />
      <AllocationDialog open={allocationOpen} onOpenChange={setAllocationOpen} projectId={project.id} budgetItems={control.budgetItems} />
    </div>
  );
}

function Metric({ label, value, risk = false }: { label: string; value: string; risk?: boolean }) {
  return <Card className={`gap-2 py-4 ${risk ? "border-destructive/40 bg-destructive/[0.03]" : ""}`}><CardContent className="px-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${risk ? "text-destructive" : ""}`}>{value}</p></CardContent></Card>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm font-medium">{value || "—"}</p></div>;
}

function Empty({ text }: { text: string }) { return <div className="px-6 py-12 text-center text-sm text-muted-foreground">{text}</div>; }
function formatDate(value: string | null, locale: string) { return value ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "—"; }
function moneyText(value: number) { return (value / 100).toFixed(2).replace(".", ","); }
function parseMoney(value: string) { const parsed = parseAmountToCents(value); if (parsed === null || parsed < 0) throw new Error("Invalid money"); return parsed; }

function EvidenceBadge({ status, label }: { status: string; label: string }) { return <Badge variant={status === "complete" ? "default" : status === "missing" ? "destructive" : "secondary"}>{label}</Badge>; }

function FormDialog({ open, onOpenChange, title, pending, onSubmit, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; pending: boolean; onSubmit: (event: React.FormEvent) => void; children: React.ReactNode }) {
  const t = useTranslations("fundingProjects");
  const tCommon = useTranslations("common");
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader><form className="grid gap-4" onSubmit={onSubmit}>{children}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin motion-reduce:animate-none" />}{t("save")}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) { return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>{children}</div>; }

function BudgetItemDialog({ open, onOpenChange, item, projectId }: { open: boolean; onOpenChange: (open: boolean) => void; item: BudgetItem | null; projectId: string }) {
  const t = useTranslations("fundingProjects"); const tCommon = useTranslations("common"); const router = useRouter();
  const [data, setData] = useState({ costType: "personnel" as FundingBudgetItemInput["costType"], customCostType: "", description: "", workPackage: "", supplierOrPerson: "", quantity: "1", unitLabel: "Stk.", unitPrice: "0,00", plannedMonth: "", eligible: "0,00", necessityJustification: "" });
  const [pending, setPending] = useState(false); const [sync, setSync] = useState<string | null>(null); const key = open ? item?.id ?? "new" : null;
  if (sync !== key) { setSync(key); if (key) setData(item ? { costType: item.costType, customCostType: item.customCostType, description: item.description, workPackage: item.workPackage, supplierOrPerson: item.supplierOrPerson, quantity: String(item.quantityThousandths / 1000).replace(".", ","), unitLabel: item.unitLabel, unitPrice: moneyText(item.unitPriceCents), plannedMonth: item.plannedMonth ?? "", eligible: moneyText(item.eligibleAmountCents), necessityJustification: item.necessityJustification } : { costType: "personnel", customCostType: "", description: "", workPackage: "", supplierOrPerson: "", quantity: "1", unitLabel: "Stk.", unitPrice: "0,00", plannedMonth: "", eligible: "0,00", necessityJustification: "" }); }
  const set = (key: keyof typeof data, value: string) => setData((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) { event.preventDefault(); setPending(true); try { await upsertFundingBudgetItem({ id: item?.id, projectId, costType: data.costType, customCostType: data.customCostType, description: data.description, workPackage: data.workPackage, supplierOrPerson: data.supplierOrPerson, quantityThousandths: Math.round(Number(data.quantity.replace(",", ".")) * 1000), unitLabel: data.unitLabel, unitPriceCents: parseMoney(data.unitPrice), plannedMonth: data.plannedMonth || null, eligibleAmountCents: parseMoney(data.eligible), necessityJustification: data.necessityJustification }); toast.success(tCommon("saved")); onOpenChange(false); router.refresh(); } catch { toast.error(t("saveError")); } finally { setPending(false); } }
  return <FormDialog open={open} onOpenChange={onOpenChange} title={item ? t("budget.edit") : t("budget.add")} pending={pending} onSubmit={submit}><div className="grid gap-4 sm:grid-cols-2"><Field id="cost-type" label={t("budget.costType")}><select id="cost-type" className={selectClass} value={data.costType} onChange={(e) => setData((c) => ({ ...c, costType: e.target.value as FundingBudgetItemInput["costType"] }))}>{(["personnel", "external_services", "material", "investments", "travel", "rent", "overhead", "program_specific"] as const).map((type) => <option key={type} value={type}>{t(`costType.${type}`)}</option>)}</select></Field>{data.costType === "program_specific" && <Field id="custom-cost" label={t("budget.customCostType")}><Input id="custom-cost" value={data.customCostType} onChange={(e) => set("customCostType", e.target.value)} required /></Field>}<div className="sm:col-span-2"><Field id="budget-description" label={t("budget.description")}><Input id="budget-description" value={data.description} onChange={(e) => set("description", e.target.value)} required /></Field></div><Field id="work-package" label={t("budget.workPackage")}><Input id="work-package" value={data.workPackage} onChange={(e) => set("workPackage", e.target.value)} /></Field><Field id="supplier" label={t("budget.supplier")}><Input id="supplier" value={data.supplierOrPerson} onChange={(e) => set("supplierOrPerson", e.target.value)} /></Field><Field id="quantity" label={t("budget.quantity")}><Input id="quantity" inputMode="decimal" value={data.quantity} onChange={(e) => set("quantity", e.target.value)} required /></Field><Field id="unit" label={t("budget.unit")}><Input id="unit" value={data.unitLabel} onChange={(e) => set("unitLabel", e.target.value)} required /></Field><Field id="unit-price" label={t("budget.unitPrice")}><Input id="unit-price" inputMode="decimal" value={data.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} required /></Field><Field id="eligible" label={t("budget.eligible")}><Input id="eligible" inputMode="decimal" value={data.eligible} onChange={(e) => set("eligible", e.target.value)} required /></Field><Field id="planned-month" label={t("budget.month")}><Input id="planned-month" type="month" value={data.plannedMonth} onChange={(e) => set("plannedMonth", e.target.value)} /></Field><div className="sm:col-span-2"><Field id="necessity" label={t("budget.necessity")}><Textarea id="necessity" value={data.necessityJustification} onChange={(e) => set("necessityJustification", e.target.value)} rows={3} /></Field></div></div>{item && <EvidencePanel targetType="fundingBudgetItem" targetId={item.id} compact />}</FormDialog>;
}

function FinancingSourceDialog({ open, onOpenChange, item, projectId }: { open: boolean; onOpenChange: (open: boolean) => void; item: FinancingSource | null; projectId: string }) {
  const t = useTranslations("fundingProjects"); const router = useRouter(); const [sourceType, setSourceType] = useState<FundingFinancingSourceInput["sourceType"]>("requested_grant"); const [label, setLabel] = useState(""); const [amount, setAmount] = useState("0,00"); const [pending, setPending] = useState(false); const [sync, setSync] = useState<string | null>(null); const key = open ? item?.id ?? "new" : null;
  if (sync !== key) { setSync(key); if (key) { setSourceType(item?.sourceType ?? "requested_grant"); setLabel(item?.label ?? ""); setAmount(moneyText(item?.amountCents ?? 0)); } }
  async function submit(e: React.FormEvent) { e.preventDefault(); setPending(true); try { await upsertFundingFinancingSource({ id: item?.id, projectId, sourceType, label, amountCents: parseMoney(amount) }); onOpenChange(false); router.refresh(); } catch { toast.error(t("saveError")); } finally { setPending(false); } }
  return <FormDialog open={open} onOpenChange={onOpenChange} title={item ? t("financing.editSource") : t("financing.addSource")} pending={pending} onSubmit={submit}><Field id="source-type" label={t("financing.sourceType")}><select id="source-type" className={selectClass} value={sourceType} onChange={(e) => setSourceType(e.target.value as FundingFinancingSourceInput["sourceType"])}>{(["requested_grant", "own_funds", "own_services", "bank", "shareholder", "other_public", "private_investor"] as const).map((type) => <option key={type} value={type}>{t(`sourceType.${type}`)}</option>)}</select></Field><Field id="source-label" label={t("financing.label")}><Input id="source-label" value={label} onChange={(e) => setLabel(e.target.value)} /></Field><Field id="source-amount" label={t("financing.amount")}><Input id="source-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field></FormDialog>;
}

function DisbursementDialog({ open, onOpenChange, item, projectId }: { open: boolean; onOpenChange: (open: boolean) => void; item: Disbursement | null; projectId: string }) {
  const t = useTranslations("fundingProjects"); const router = useRouter(); const [data, setData] = useState({ label: "", plannedDate: "", amount: "0,00", status: "planned" as FundingDisbursementInput["status"], receivedAt: "" }); const [pending, setPending] = useState(false); const [sync, setSync] = useState<string | null>(null); const key = open ? item?.id ?? "new" : null;
  if (sync !== key) { setSync(key); if (key) setData({ label: item?.label ?? "", plannedDate: item?.plannedDate ?? "", amount: moneyText(item?.amountCents ?? 0), status: item?.status ?? "planned", receivedAt: item?.receivedAt ?? "" }); }
  async function submit(e: React.FormEvent) { e.preventDefault(); setPending(true); try { await upsertFundingDisbursement({ id: item?.id, projectId, label: data.label, plannedDate: data.plannedDate || null, amountCents: parseMoney(data.amount), status: data.status, receivedAt: data.receivedAt || null }); onOpenChange(false); router.refresh(); } catch { toast.error(t("saveError")); } finally { setPending(false); } }
  return <FormDialog open={open} onOpenChange={onOpenChange} title={item ? t("financing.editDisbursement") : t("financing.addDisbursement")} pending={pending} onSubmit={submit}><Field id="tranche-label" label={t("financing.label")}><Input id="tranche-label" value={data.label} onChange={(e) => setData((c) => ({ ...c, label: e.target.value }))} required /></Field><Field id="tranche-date" label={t("financing.plannedDate")}><Input id="tranche-date" type="date" value={data.plannedDate} onChange={(e) => setData((c) => ({ ...c, plannedDate: e.target.value }))} /></Field><Field id="tranche-amount" label={t("financing.amount")}><Input id="tranche-amount" inputMode="decimal" value={data.amount} onChange={(e) => setData((c) => ({ ...c, amount: e.target.value }))} required /></Field><Field id="tranche-status" label={t("fields.status")}><select id="tranche-status" className={selectClass} value={data.status} onChange={(e) => setData((c) => ({ ...c, status: e.target.value as FundingDisbursementInput["status"] }))}><option value="planned">{t("disbursementStatus.planned")}</option><option value="received">{t("disbursementStatus.received")}</option></select></Field>{data.status === "received" && <Field id="received-at" label={t("financing.receivedAt")}><Input id="received-at" type="date" value={data.receivedAt} onChange={(e) => setData((c) => ({ ...c, receivedAt: e.target.value }))} /></Field>}</FormDialog>;
}

function AllocationDialog({ open, onOpenChange, projectId, budgetItems }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; budgetItems: BudgetItem[] }) {
  const t = useTranslations("fundingProjects"); const router = useRouter(); const [data, setData] = useState({ budgetItemId: "", accountingEntryId: "", bookingDate: new Date().toISOString().slice(0, 10), description: "", amount: "0,00", evidenceStatus: "missing" as FundingBookingAllocationInput["evidenceStatus"], evidenceNote: "" }); const [pending, setPending] = useState(false); const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) { setWasOpen(open); if (open) setData({ budgetItemId: budgetItems[0]?.id ?? "", accountingEntryId: "", bookingDate: new Date().toISOString().slice(0, 10), description: "", amount: "0,00", evidenceStatus: "missing", evidenceNote: "" }); }
  async function submit(e: React.FormEvent) { e.preventDefault(); setPending(true); try { await upsertFundingBookingAllocation({ projectId, budgetItemId: data.budgetItemId, accountingEntryId: data.accountingEntryId || null, bookingDate: data.bookingDate, description: data.description, actualAmountCents: parseMoney(data.amount), evidenceStatus: data.evidenceStatus, evidenceNote: data.evidenceNote }); onOpenChange(false); router.refresh(); } catch { toast.error(t("saveError")); } finally { setPending(false); } }
  return <FormDialog open={open} onOpenChange={onOpenChange} title={t("settlement.addActual")} pending={pending} onSubmit={submit}><Field id="allocation-budget" label={t("settlement.budgetItem")}><select id="allocation-budget" className={selectClass} value={data.budgetItemId} onChange={(e) => setData((c) => ({ ...c, budgetItemId: e.target.value }))}>{budgetItems.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}</select></Field><Field id="allocation-date" label={t("settlement.bookingDate")}><Input id="allocation-date" type="date" value={data.bookingDate} onChange={(e) => setData((c) => ({ ...c, bookingDate: e.target.value }))} required /></Field><Field id="allocation-description" label={t("budget.description")}><Input id="allocation-description" value={data.description} onChange={(e) => setData((c) => ({ ...c, description: e.target.value }))} /></Field><Field id="allocation-amount" label={t("settlement.actualAmount")}><Input id="allocation-amount" inputMode="decimal" value={data.amount} onChange={(e) => setData((c) => ({ ...c, amount: e.target.value }))} required /></Field><Field id="accounting-entry" label={t("settlement.accountingEntryId")}><Input id="accounting-entry" value={data.accountingEntryId} onChange={(e) => setData((c) => ({ ...c, accountingEntryId: e.target.value }))} placeholder={t("settlement.accountingEntryPlaceholder")} /></Field><Field id="evidence-status" label={t("settlement.evidenceStatus")}><select id="evidence-status" className={selectClass} value={data.evidenceStatus} onChange={(e) => setData((c) => ({ ...c, evidenceStatus: e.target.value as FundingBookingAllocationInput["evidenceStatus"] }))}><option value="missing">{t("evidence.missing")}</option><option value="partial">{t("evidence.partial")}</option><option value="complete">{t("evidence.complete")}</option></select></Field><Field id="evidence-note" label={t("settlement.evidenceNote")}><Textarea id="evidence-note" value={data.evidenceNote} onChange={(e) => setData((c) => ({ ...c, evidenceNote: e.target.value }))} /></Field></FormDialog>;
}
