"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Car,
  CircleDollarSign,
  HandCoins,
  Info,
  Landmark,
  Loader2,
  Paperclip,
  Plane,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Upload,
  Users,
  Utensils,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { deleteEntry, upsertEntry, type EntryInput } from "@/modules/accounting/actions";
import type { EntryRow } from "@/modules/accounting/queries";
import type { categories as categoriesTable, CategoryTemplate } from "@/modules/accounting/schema";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { breakdownFromGross, breakdownFromNet, VAT_RATES } from "../lib/vat";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Category = typeof categoriesTable.$inferSelect;
type AttachmentDto = { id: string; fileName: string };
type AmountMode = "gross" | "net";
type TaxLineState = {
  key: string;
  description: string;
  amountText: string;
  mode: AmountMode;
  vatRate: number;
  inputVatDeductiblePercent: number;
};

const NON_VAT_TEMPLATES = new Set<CategoryTemplate>(["personnel", "svs", "tax_levy", "grant_income"]);
const EVIDENCE_TEMPLATES = new Set<CategoryTemplate>([
  "hospitality",
  "travel",
  "vehicle",
  "asset",
  "personnel",
]);

const TEMPLATE_ICONS = {
  standard_income: CircleDollarSign,
  grant_income: HandCoins,
  standard_expense: ReceiptText,
  hospitality: Utensils,
  travel: Plane,
  vehicle: Car,
  asset: BriefcaseBusiness,
  personnel: Users,
  svs: Landmark,
  tax_levy: Landmark,
} satisfies Record<CategoryTemplate, typeof ReceiptText>;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nextMonth(value: string) {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match) return value;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  if (!match[3]) return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(Number(match[3]), lastDay);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function moneyText(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function newLine(vatRate = 20, inputVatDeductiblePercent = 100): TaxLineState {
  return {
    key: crypto.randomUUID(),
    description: "",
    amountText: "",
    mode: "gross",
    vatRate,
    inputVatDeductiblePercent,
  };
}

function TaxHelp({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-full text-[#6f7f79] hover:bg-[#eaf0ed] hover:text-[#244c40] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315c73]"
            aria-label={text}
          />
        }
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-80 leading-5">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({ htmlFor, children, help }: { htmlFor?: string; children: React.ReactNode; help?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{children}</Label>
      {help && <TaxHelp text={help} />}
    </span>
  );
}

export function EntryDialog({
  open,
  onOpenChange,
  entry,
  categories,
  canManagePersonnel,
  taxSettings,
  fundingProjects,
  personnelEmployees,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: EntryRow | null;
  categories: Category[];
  canManagePersonnel: boolean;
  taxSettings: { kleinunternehmer: boolean; defaultVatRate: number };
  fundingProjects: Array<{ id: string; name: string }>;
  personnelEmployees: Array<{ id: string; name: string; personnelNumber: string; employmentType: string }>;
}) {
  const t = useTranslations("accounting");
  const tf = useTranslations("accountingEntry");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"category" | "form">("category");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [documentDate, setDocumentDate] = useState(todayIso());
  const [documentNumber, setDocumentNumber] = useState("");
  const [servicePeriodStart, setServicePeriodStart] = useState("");
  const [servicePeriodEnd, setServicePeriodEnd] = useState("");
  const [description, setDescription] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "cash" | "card">("bank");
  const [notes, setNotes] = useState("");
  const [deductiblePercent, setDeductiblePercent] = useState(100);
  const [warningOverrideReason, setWarningOverrideReason] = useState("");
  const [taxLines, setTaxLines] = useState<TaxLineState[]>([newLine()]);
  const [special, setSpecial] = useState<Record<string, string | boolean>>({});
  const [existingAttachments, setExistingAttachments] = useState<AttachmentDto[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [syncKey, setSyncKey] = useState<string | null>(null);

  const currentKey = open ? (entry?.id ?? "new") : null;
  if (syncKey !== currentKey) {
    setSyncKey(currentKey);
    if (currentKey !== null) {
      const entrySpecial = entry?.specialFields ?? {};
      setStep(entry ? "form" : "category");
      setIsDuplicate(false);
      setSearch("");
      setKind(entry?.kind ?? "expense");
      setCategoryId(entry?.categoryId ?? "");
      setDate(entry?.date ?? todayIso());
      setDocumentDate(entry?.documentDate ?? entry?.date ?? todayIso());
      setDocumentNumber(entry?.documentNumber ?? "");
      setServicePeriodStart(entry?.servicePeriodStart ?? "");
      setServicePeriodEnd(entry?.servicePeriodEnd ?? "");
      setDescription(entry?.description ?? "");
      setCounterparty(entry?.counterparty ?? "");
      setPaymentMethod(entry?.paymentMethod ?? "bank");
      setNotes(entry?.notes ?? "");
      setDeductiblePercent(entry?.deductiblePercent ?? 100);
      setWarningOverrideReason(entry?.warningOverrideReason ?? "");
      setSpecial(
        Object.fromEntries(
          Object.entries(entrySpecial).map(([key, value]) => [key, typeof value === "boolean" ? value : String(value ?? "")]),
        ),
      );
      setTaxLines(
        entry?.taxLines.length
          ? entry.taxLines.map((line) => ({
              key: line.id,
              description: line.description,
              amountText: moneyText(line.grossAmountCents),
              mode: "gross" as const,
              vatRate: line.vatRate,
              inputVatDeductiblePercent: line.inputVatDeductiblePercent,
            }))
          : [newLine(entry?.vatRate ?? 20)],
      );
      setExistingAttachments([]);
      setPendingFiles([]);
    }
  }

  useEffect(() => {
    if (!open || !entry) return;
    let cancelled = false;
    fetch(`/api/files?entityType=entry&entityId=${entry.id}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => {
        if (!cancelled) setExistingAttachments(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, entry]);

  const category = categories.find((item) => item.id === categoryId);
  const template = category?.template ?? (kind === "income" ? "standard_income" : "standard_expense");
  const filteredCategories = categories.filter(
    (item) =>
      (canManagePersonnel || item.template !== "personnel") &&
      (!search.trim() || item.name.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale))),
  );

  function setSpecialValue(key: string, value: string | boolean) {
    setSpecial((current) => ({ ...current, [key]: value }));
  }

  function chooseCategory(next: Category) {
    setCategoryId(next.id);
    setKind(next.kind);
    const rateFromName = VAT_RATES.find((rate) => next.name.includes(`${rate} %`));
    const rate = NON_VAT_TEMPLATES.has(next.template) || (taxSettings.kleinunternehmer && next.kind === "income")
      ? 0
      : (rateFromName ?? taxSettings.defaultVatRate);
    const inputPercent = next.template === "vehicle" || taxSettings.kleinunternehmer ? 0 : 100;
    setTaxLines([newLine(rate, inputPercent)]);
    setStep("form");
  }

  function duplicatePersonnelMonth() {
    setIsDuplicate(true);
    setDate((current) => nextMonth(current));
    setDocumentDate((current) => nextMonth(current));
    setDocumentNumber("");
    setWarningOverrideReason("");
    setExistingAttachments([]);
    setPendingFiles([]);
    setSpecial((current) => {
      const shifted = { ...current };
      for (const key of [
        "payrollMonth",
        "employeePaymentDate",
        "socialPaymentDate",
        "taxPaymentDate",
        "municipalPaymentDate",
        "provisionPaymentDate",
      ]) {
        if (typeof shifted[key] === "string" && shifted[key]) shifted[key] = nextMonth(shifted[key]);
      }
      return shifted;
    });
  }

  const personnelCostCents = useMemo(() => {
    if (template !== "personnel") return null;
    return ["grossSalary", "employerSv", "db", "dz", "municipalTax", "bvContribution", "viennaLevy", "otherPersonnelCost"]
      .map((key) => parseAmountToCents(String(special[key] ?? "")) ?? 0)
      .reduce((sum, value) => sum + value, 0);
  }, [special, template]);

  const computedLines = useMemo(() => {
    if (template === "personnel") {
      if (!personnelCostCents) return [];
      return [{
        description: tf("personnel.total"),
        netAmountCents: personnelCostCents,
        vatRate: 0,
        vatAmountCents: 0,
        grossAmountCents: personnelCostCents,
        inputVatDeductiblePercent: 0,
      }];
    }
    return taxLines.flatMap((line) => {
      const cents = parseAmountToCents(line.amountText);
      if (cents === null || cents <= 0) return [];
      const breakdown = line.mode === "gross"
        ? breakdownFromGross(cents, line.vatRate as (typeof VAT_RATES)[number])
        : breakdownFromNet(cents, line.vatRate as (typeof VAT_RATES)[number]);
      return [{
        description: line.description,
        netAmountCents: breakdown.netCents,
        vatRate: line.vatRate,
        vatAmountCents: breakdown.vatCents,
        grossAmountCents: breakdown.grossCents,
        inputVatDeductiblePercent: taxSettings.kleinunternehmer ? 0 : line.inputVatDeductiblePercent,
      }];
    });
  }, [personnelCostCents, taxLines, taxSettings.kleinunternehmer, template, tf]);

  const computedPaymentLines = useMemo(() => {
    if (template !== "personnel") {
      return [];
    }
    const amount = (key: string) => parseAmountToCents(String(special[key] ?? "")) ?? 0;
    const lines = [
      { date: String(special.employeePaymentDate || date), description: tf("personnel.payments.net"), recipient: String(special.employeeName ?? ""), amountCents: amount("netSalary"), paymentMethod },
      { date: String(special.socialPaymentDate || date), description: tf("personnel.payments.social"), recipient: "ÖGK", amountCents: amount("employeeSv") + amount("employerSv"), paymentMethod },
      { date: String(special.taxPaymentDate || date), description: tf("personnel.payments.taxOffice"), recipient: "Finanzamt", amountCents: amount("wageTax") + amount("db") + amount("dz"), paymentMethod },
      { date: String(special.municipalPaymentDate || date), description: tf("personnel.payments.municipality"), recipient: String(special.municipality ?? "Gemeinde"), amountCents: amount("municipalTax") + amount("viennaLevy"), paymentMethod },
      { date: String(special.provisionPaymentDate || date), description: tf("personnel.payments.provision"), recipient: String(special.provisionFund ?? "Vorsorgekasse"), amountCents: amount("bvContribution"), paymentMethod },
      { date, description: tf("personnel.payments.other"), recipient: counterparty, amountCents: amount("otherPersonnelCost"), paymentMethod },
    ];
    return lines.filter((line) => line.amountCents > 0);
  }, [counterparty, date, paymentMethod, special, template, tf]);

  const totals = computedLines.reduce(
    (sum, line) => ({ net: sum.net + line.netAmountCents, vat: sum.vat + line.vatAmountCents, gross: sum.gross + line.grossAmountCents }),
    { net: 0, vat: 0, gross: 0 },
  );
  const paymentLines = template === "personnel"
    ? computedPaymentLines
    : totals.gross > 0
      ? [{ date, description, recipient: counterparty, amountCents: totals.gross, paymentMethod }]
      : [];
  const paymentTotal = paymentLines.reduce((sum, line) => sum + line.amountCents, 0);
  const hasEvidence = existingAttachments.length > 0 || pendingFiles.length > 0;
  const warnings = [
    ...(EVIDENCE_TEMPLATES.has(template) && !hasEvidence ? [tf("warnings.missingEvidence")] : []),
    ...(template === "hospitality" && (!special.participants || !special.businessPurpose) ? [tf("warnings.hospitalityDetails")] : []),
    ...(template === "travel" && (!special.destination || !special.travelPurpose) ? [tf("warnings.travelDetails")] : []),
    ...(template === "vehicle" && !special.vehicleType ? [tf("warnings.vehicleDetails")] : []),
    ...(template === "asset" && !special.usefulLifeYears ? [tf("warnings.assetDetails")] : []),
    ...(template === "personnel" && paymentTotal !== totals.gross ? [tf("warnings.personnelReconciliation")] : []),
  ];

  async function uploadFiles(entryId: string) {
    for (const file of pendingFiles) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", "entry");
      formData.append("entityId", entryId);
      const response = await fetch("/api/files", { method: "POST", body: formData });
      if (!response.ok) toast.error(`${t("uploadFailed")}: ${file.name}`);
    }
  }

  async function save(status: "draft" | "finalized") {
    if (!categoryId) return;
    if (status === "finalized" && (!description.trim() || totals.gross <= 0)) return;
    if (status === "finalized" && warnings.length > 0 && !warningOverrideReason.trim()) return;
    setPending(true);
    try {
      const input: EntryInput = {
        id: isDuplicate ? undefined : entry?.id,
        kind,
        date,
        documentDate: documentDate || null,
        documentNumber,
        servicePeriodStart: servicePeriodStart || null,
        servicePeriodEnd: servicePeriodEnd || null,
        status,
        description: description.trim() || tf("untitledDraft"),
        counterparty,
        categoryId,
        grossAmountCents: totals.gross,
        vatRate: computedLines[0]?.vatRate ?? 0,
        paymentMethod,
        notes,
        deductiblePercent,
        warningOverrideReason,
        specialFields: Object.fromEntries(
          Object.entries(special).map(([key, value]) => [key, value === "" ? null : value]),
        ),
        taxLines: computedLines,
        paymentLines,
      };
      const { id } = await upsertEntry(input);
      if (pendingFiles.length) await uploadFiles(id);
      toast.success(status === "draft" ? tf("draftSaved") : tc("saved"));
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(tc("error"));
    } finally {
      setPending(false);
    }
  }

  async function removeExistingAttachment(id: string) {
    const response = await fetch(`/api/files/${id}`, { method: "DELETE" });
    if (response.ok) setExistingAttachments((current) => current.filter((item) => item.id !== id));
  }

  async function removeEntry() {
    if (!entry || !window.confirm(entry.status === "draft" ? tf("deleteDraftConfirm") : tf("voidConfirm"))) return;
    setPending(true);
    try {
      await deleteEntry(entry.id);
      toast.success(entry.status === "draft" ? tf("draftDeleted") : tf("voided"));
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(tc("error"));
    } finally {
      setPending(false);
    }
  }

  function renderSpecialFields() {
    if (template === "grant_income") return (
      <section className="rounded-xl border border-[#dfe6e2] bg-[#f8faf8] p-4">
        <div className="max-w-md"><FieldLabel>{tf("fundingProject")}</FieldLabel><Select value={String(special.fundingProjectId ?? "none")} onValueChange={(value) => setSpecialValue("fundingProjectId", value === "none" ? "" : (value ?? ""))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{tf("noFundingProject")}</SelectItem>{fundingProjects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select><p className="mt-1.5 text-xs text-[#7c8984]">{tf("fundingProjectHint")}</p></div>
      </section>
    );
    if (template === "hospitality") return (
      <section className="grid gap-4 rounded-xl border border-[#dfe6e2] bg-[#f8faf8] p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><FieldLabel htmlFor="business-purpose" help={tf("help.businessPurpose")}>{tf("businessPurpose")}</FieldLabel><Input id="business-purpose" value={String(special.businessPurpose ?? "")} onChange={(e) => setSpecialValue("businessPurpose", e.target.value)} /></div>
        <div><FieldLabel htmlFor="participants" help={tf("help.participants")}>{tf("participants")}</FieldLabel><Input id="participants" value={String(special.participants ?? "")} onChange={(e) => setSpecialValue("participants", e.target.value)} /></div>
        <label className="flex items-center gap-3 self-end rounded-lg border bg-white p-3"><Checkbox checked={special.advertisingPurpose === true} onCheckedChange={(checked) => setSpecialValue("advertisingPurpose", checked === true)} /><span>{tf("advertisingPurpose")}</span><TaxHelp text={tf("help.advertisingPurpose")} /></label>
      </section>
    );
    if (template === "travel") {
      const km = Number(String(special.kilometres ?? "").replace(",", ".")) || 0;
      return (
        <section className="grid gap-4 rounded-xl border border-[#dfe6e2] bg-[#f8faf8] p-4 sm:grid-cols-2">
          <div><FieldLabel htmlFor="traveler">{tf("traveler")}</FieldLabel><Input id="traveler" value={String(special.traveler ?? "")} onChange={(e) => setSpecialValue("traveler", e.target.value)} /></div>
          <div><FieldLabel htmlFor="destination">{tf("destination")}</FieldLabel><Input id="destination" value={String(special.destination ?? "")} onChange={(e) => setSpecialValue("destination", e.target.value)} /></div>
          <div className="sm:col-span-2"><FieldLabel htmlFor="travel-purpose">{tf("travelPurpose")}</FieldLabel><Input id="travel-purpose" value={String(special.travelPurpose ?? "")} onChange={(e) => setSpecialValue("travelPurpose", e.target.value)} /></div>
          <div><FieldLabel htmlFor="trip-start">{tf("tripStart")}</FieldLabel><Input id="trip-start" type="datetime-local" value={String(special.tripStart ?? "")} onChange={(e) => setSpecialValue("tripStart", e.target.value)} /></div>
          <div><FieldLabel htmlFor="trip-end">{tf("tripEnd")}</FieldLabel><Input id="trip-end" type="datetime-local" value={String(special.tripEnd ?? "")} onChange={(e) => setSpecialValue("tripEnd", e.target.value)} /></div>
          <div><FieldLabel htmlFor="kilometres" help={tf("help.kilometreAllowance")}>{tf("kilometres")}</FieldLabel><Input id="kilometres" inputMode="decimal" value={String(special.kilometres ?? "")} onChange={(e) => setSpecialValue("kilometres", e.target.value)} /></div>
          <div className="rounded-lg border border-[#d6e1dc] bg-white p-3 text-sm"><span className="text-[#6c7b75]">{tf("kilometreSuggestion")}</span><strong className="mt-1 block text-[#24483d]">{formatCents(Math.round(km * 50), locale)}</strong><span className="text-xs text-[#87938f]">{tf("ruleReviewRequired")}</span></div>
        </section>
      );
    }
    if (template === "vehicle") return (
      <section className="grid gap-4 rounded-xl border border-[#dfe6e2] bg-[#f8faf8] p-4 sm:grid-cols-2">
        <div><FieldLabel htmlFor="vehicle-name">{tf("vehicleName")}</FieldLabel><Input id="vehicle-name" value={String(special.vehicleName ?? "")} onChange={(e) => setSpecialValue("vehicleName", e.target.value)} /></div>
        <div><FieldLabel htmlFor="vehicle-type" help={tf("help.vehicleType")}>{tf("vehicleType")}</FieldLabel><Select value={String(special.vehicleType ?? "")} onValueChange={(value) => setSpecialValue("vehicleType", value ?? "")}><SelectTrigger id="vehicle-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pkw">{tf("vehicleTypes.pkw")}</SelectItem><SelectItem value="fiscalTruck">{tf("vehicleTypes.fiscalTruck")}</SelectItem><SelectItem value="electric">{tf("vehicleTypes.electric")}</SelectItem><SelectItem value="other">{tf("vehicleTypes.other")}</SelectItem></SelectContent></Select></div>
        <div><FieldLabel htmlFor="business-use">{tf("businessUsePercent")}</FieldLabel><Input id="business-use" type="number" min={0} max={100} value={String(special.businessUsePercent ?? "100")} onChange={(e) => setSpecialValue("businessUsePercent", e.target.value)} /></div>
        <label className="flex items-center gap-3 self-end rounded-lg border bg-white p-3"><Checkbox checked={special.inputVatEligible === true} onCheckedChange={(checked) => setSpecialValue("inputVatEligible", checked === true)} /><span>{tf("inputVatEligible")}</span><TaxHelp text={tf("help.inputVatVehicle")} /></label>
      </section>
    );
    if (template === "asset") return (
      <section className="grid gap-4 rounded-xl border border-[#dfe6e2] bg-[#f8faf8] p-4 sm:grid-cols-3">
        <div className="sm:col-span-3"><FieldLabel htmlFor="asset-name">{tf("assetName")}</FieldLabel><Input id="asset-name" value={String(special.assetName ?? "")} onChange={(e) => setSpecialValue("assetName", e.target.value)} /></div>
        <div><FieldLabel htmlFor="placed-in-service">{tf("placedInService")}</FieldLabel><Input id="placed-in-service" type="date" value={String(special.placedInServiceOn ?? documentDate)} onChange={(e) => setSpecialValue("placedInServiceOn", e.target.value)} /></div>
        <div><FieldLabel htmlFor="useful-life" help={tf("help.usefulLife")}>{tf("usefulLifeYears")}</FieldLabel><Input id="useful-life" type="number" min={1} max={100} value={String(special.usefulLifeYears ?? "")} onChange={(e) => setSpecialValue("usefulLifeYears", e.target.value)} /></div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{tf("assetReviewNotice")}</div>
      </section>
    );
    if (template === "personnel") {
      const fields = ["grossSalary", "netSalary", "employeeSv", "wageTax", "employerSv", "db", "dz", "municipalTax", "bvContribution", "viennaLevy", "otherPersonnelCost"] as const;
      return (
        <section className="grid gap-4 rounded-xl border border-[#dddfd7] bg-[#faf9f5] p-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><FieldLabel>{tf("personnel.employeeMaster")}</FieldLabel><Select value={special.employeeId ? String(special.employeeId) : "new"} onValueChange={(value) => { const employee = personnelEmployees.find((item) => item.id === value); setSpecial((current) => employee ? { ...current, employeeId: employee.id, employeeName: employee.name, personnelNumber: employee.personnelNumber, employmentType: employee.employmentType } : { ...current, employeeId: "", employeeName: "", personnelNumber: "", employmentType: "employee" }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">{tf("personnel.newEmployee")}</SelectItem>{personnelEmployees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}{employee.personnelNumber ? ` · ${employee.personnelNumber}` : ""}</SelectItem>)}</SelectContent></Select></div>
          <div><FieldLabel htmlFor="employee-name">{tf("personnel.employeeName")}</FieldLabel><Input id="employee-name" value={String(special.employeeName ?? "")} disabled={Boolean(special.employeeId)} onChange={(e) => setSpecialValue("employeeName", e.target.value)} /></div>
          <div><FieldLabel htmlFor="personnel-number">{tf("personnel.personnelNumber")}</FieldLabel><Input id="personnel-number" value={String(special.personnelNumber ?? "")} onChange={(e) => setSpecialValue("personnelNumber", e.target.value)} /></div>
          <div><FieldLabel htmlFor="employment-type">{tf("personnel.employmentType")}</FieldLabel><Select value={String(special.employmentType ?? "employee")} disabled={Boolean(special.employeeId)} onValueChange={(value) => setSpecialValue("employmentType", value ?? "employee")}><SelectTrigger id="employment-type"><SelectValue /></SelectTrigger><SelectContent>{["worker", "employee", "marginal", "apprentice", "freelance", "managing_director"].map((item) => <SelectItem key={item} value={item}>{tf(`personnel.types.${item}`)}</SelectItem>)}</SelectContent></Select></div>
          <div><FieldLabel htmlFor="payroll-month">{tf("personnel.payrollMonth")}</FieldLabel><Input id="payroll-month" type="month" value={String(special.payrollMonth ?? "")} onChange={(e) => setSpecialValue("payrollMonth", e.target.value)} /></div>
          {fields.map((field) => <div key={field}><FieldLabel htmlFor={field} help={tf(`personnel.help.${field}`)}>{tf(`personnel.${field}`)}</FieldLabel><Input id={field} inputMode="decimal" placeholder="0,00" value={String(special[field] ?? "")} onChange={(e) => setSpecialValue(field, e.target.value)} /></div>)}
          <div className="sm:col-span-2 mt-2 border-t border-[#ded9cc] pt-4"><h4 className="font-medium text-[#4d493e]">{tf("personnel.paymentDates")}</h4><p className="mt-1 text-xs text-[#766f60]">{tf("personnel.paymentDatesHint")}</p></div>
          {(["employeePaymentDate", "socialPaymentDate", "taxPaymentDate", "municipalPaymentDate", "provisionPaymentDate"] as const).map((field) => <div key={field}><FieldLabel htmlFor={field}>{tf(`personnel.${field}`)}</FieldLabel><Input id={field} type="date" value={String(special[field] ?? date)} onChange={(e) => setSpecialValue(field, e.target.value)} /></div>)}
          <div className="sm:col-span-2 flex items-center justify-between rounded-lg bg-[#24483d] px-4 py-3 text-white"><span>{tf("personnel.total")}</span><strong>{formatCents(personnelCostCents ?? 0, locale)}</strong></div>
          <div className="sm:col-span-2 flex items-center justify-between rounded-lg border border-[#d8d2c3] bg-white px-4 py-3 text-[#4d493e]"><span>{tf("personnel.paymentTotal")}</span><strong>{formatCents(paymentTotal, locale)}</strong></div>
          <p className="sm:col-span-2 text-xs leading-5 text-[#766f60]">{tf("personnel.noPayrollCalculation")}</p>
        </section>
      );
    }
    if (template === "svs" || template === "tax_levy") return (
      <section className="grid gap-4 rounded-xl border border-[#dfe6e2] bg-[#f8faf8] p-4 sm:grid-cols-3">
        <div><FieldLabel htmlFor="authority">{tf("authority")}</FieldLabel><Input id="authority" value={String(special.authority ?? "")} onChange={(e) => setSpecialValue("authority", e.target.value)} /></div>
        <div><FieldLabel htmlFor="levy-type">{tf("levyType")}</FieldLabel><Input id="levy-type" value={String(special.levyType ?? "")} onChange={(e) => setSpecialValue("levyType", e.target.value)} /></div>
        <div><FieldLabel htmlFor="assessment-period">{tf("assessmentPeriod")}</FieldLabel><Input id="assessment-period" value={String(special.assessmentPeriod ?? "")} onChange={(e) => setSpecialValue("assessmentPeriod", e.target.value)} /></div>
      </section>
    );
    return null;
  }

  return (
    <TooltipProvider>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-4xl">
          {step === "category" ? (
            <div className="p-5 sm:p-7">
              <DialogHeader>
                <p className="text-xs font-semibold tracking-[0.12em] text-[#71807a] uppercase">{tf("stepOne")}</p>
                <DialogTitle className="text-2xl tracking-[-0.03em] text-[#173c32]">{tf("chooseCategory")}</DialogTitle>
                <p className="max-w-2xl text-sm leading-6 text-[#6e7b76]">{tf("chooseCategoryDescription")}</p>
              </DialogHeader>
              <div className="relative mt-5"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#87938f]" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tf("searchCategories")} className="h-10 pl-9" autoFocus /></div>
              {(["expense", "income"] as const).map((group) => {
                const items = filteredCategories.filter((item) => item.kind === group);
                if (!items.length) return null;
                return <section key={group} className="mt-6"><h3 className="mb-3 text-xs font-semibold tracking-[0.1em] text-[#75837e] uppercase">{group === "expense" ? t("expensePlural") : t("incomePlural")}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => { const Icon = TEMPLATE_ICONS[item.template]; return <button key={item.id} type="button" onClick={() => chooseCategory(item)} className="group rounded-xl border border-[#dfe5e1] bg-white p-4 text-left shadow-[0_1px_2px_rgba(20,47,39,0.03)] transition hover:-translate-y-0.5 hover:border-[#aebfb7] hover:shadow-[0_8px_24px_rgba(20,47,39,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315c73]"><span className="flex items-start justify-between gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-[#edf3f0] text-[#315c73]"><Icon className="size-4.5" /></span><span className="mt-1 size-2.5 rounded-full" style={{ backgroundColor: item.color }} /></span><strong className="mt-4 block text-sm text-[#213c35]">{item.name}</strong><span className="mt-1.5 block text-xs leading-5 text-[#74827d]">{tf(`templates.${item.template}.description`)}</span></button>; })}</div></section>;
              })}
            </div>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void save("finalized"); }}>
              <div className="sticky top-0 z-10 border-b border-[#e0e6e3] bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
                <button type="button" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[#59716a] hover:text-[#173c32]" onClick={() => setStep("category")}><ArrowLeft className="size-3.5" />{tf("changeCategory")}</button>
                <DialogHeader><p className="text-xs font-semibold tracking-[0.12em] text-[#71807a] uppercase">{category?.name}</p><DialogTitle className="text-xl tracking-[-0.025em] text-[#173c32]">{entry && !isDuplicate ? t("editEntry") : t("newEntry")}</DialogTitle></DialogHeader>
              </div>
              <div className="flex flex-col gap-5 px-5 py-5 sm:px-7">
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div><FieldLabel htmlFor="entry-date" help={tf("help.paymentDate")}>{t("date")}</FieldLabel><Input id="entry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
                  <div><FieldLabel htmlFor="document-date">{tf("documentDate")}</FieldLabel><Input id="document-date" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} /></div>
                  <div><FieldLabel htmlFor="document-number">{tf("documentNumber")}</FieldLabel><Input id="document-number" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} /></div>
                  <div><FieldLabel>{t("paymentMethod")}</FieldLabel><Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as typeof paymentMethod)}><SelectTrigger><SelectValue>{t(paymentMethod)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="bank">{t("bank")}</SelectItem><SelectItem value="cash">{t("cash")}</SelectItem><SelectItem value="card">{t("card")}</SelectItem></SelectContent></Select></div>
                  <div className="sm:col-span-2"><FieldLabel htmlFor="entry-description">{t("description")}</FieldLabel><Input id="entry-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></div>
                  <div className="sm:col-span-2"><FieldLabel htmlFor="entry-counterparty">{t("counterparty")}</FieldLabel><Input id="entry-counterparty" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} maxLength={200} /></div>
                  <div><FieldLabel htmlFor="service-start">{tf("servicePeriodStart")}</FieldLabel><Input id="service-start" type="date" value={servicePeriodStart} onChange={(e) => setServicePeriodStart(e.target.value)} /></div>
                  <div><FieldLabel htmlFor="service-end">{tf("servicePeriodEnd")}</FieldLabel><Input id="service-end" type="date" value={servicePeriodEnd} onChange={(e) => setServicePeriodEnd(e.target.value)} /></div>
                </section>

                {renderSpecialFields()}

                {template !== "personnel" && <section className="rounded-xl border border-[#dfe5e1]">
                  <div className="flex items-center justify-between border-b border-[#e4e9e6] bg-[#f8faf8] px-4 py-3"><div><h3 className="font-medium text-[#29463e]">{tf("taxLines")}</h3><p className="text-xs text-[#7c8984]">{taxSettings.kleinunternehmer ? tf("smallBusinessTaxNotice") : tf("taxLinesDescription")}</p></div><Button type="button" variant="outline" size="sm" onClick={() => setTaxLines((current) => [...current, newLine(NON_VAT_TEMPLATES.has(template) ? 0 : taxSettings.defaultVatRate, taxSettings.kleinunternehmer ? 0 : 100)])}><Plus className="size-3.5" />{tf("addTaxLine")}</Button></div>
                  <div className="divide-y divide-[#e8ecea]">{taxLines.map((line, index) => {
                    const computed = computedLines[index];
                    return <div key={line.key} className="grid gap-3 p-4 sm:grid-cols-[1fr_120px_110px_100px_auto] sm:items-end">
                      <div><FieldLabel htmlFor={`line-description-${line.key}`}>{tf("lineDescription")}</FieldLabel><Input id={`line-description-${line.key}`} value={line.description} onChange={(e) => setTaxLines((current) => current.map((item) => item.key === line.key ? { ...item, description: e.target.value } : item))} /></div>
                      <div><FieldLabel htmlFor={`line-amount-${line.key}`}>{line.mode === "gross" ? t("gross") : t("net")}</FieldLabel><Input id={`line-amount-${line.key}`} inputMode="decimal" placeholder="0,00" value={line.amountText} onChange={(e) => setTaxLines((current) => current.map((item) => item.key === line.key ? { ...item, amountText: e.target.value } : item))} /></div>
                      <div><FieldLabel>{tf("amountMode")}</FieldLabel><Select value={line.mode} onValueChange={(value) => setTaxLines((current) => current.map((item) => item.key === line.key ? { ...item, mode: value as AmountMode } : item))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gross">{t("gross")}</SelectItem><SelectItem value="net">{t("net")}</SelectItem></SelectContent></Select></div>
                      <div><FieldLabel help={tf("help.vatRate")}>{t("vatRate")}</FieldLabel><Select value={String(line.vatRate)} onValueChange={(value) => setTaxLines((current) => current.map((item) => item.key === line.key ? { ...item, vatRate: Number(value) } : item))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VAT_RATES.map((rate) => <SelectItem key={rate} value={String(rate)}>{rate} %</SelectItem>)}</SelectContent></Select></div>
                      <Button type="button" variant="ghost" size="icon-sm" disabled={taxLines.length === 1} onClick={() => setTaxLines((current) => current.filter((item) => item.key !== line.key))}><Trash2 className="size-4" /></Button>
                      {kind === "expense" && <div className="sm:col-span-2"><FieldLabel htmlFor={`input-vat-${line.key}`} help={tf("help.inputVatDeductible")}>{tf("inputVatDeductiblePercent")}</FieldLabel><Input id={`input-vat-${line.key}`} type="number" min={0} max={100} disabled={taxSettings.kleinunternehmer} value={taxSettings.kleinunternehmer ? 0 : line.inputVatDeductiblePercent} onChange={(e) => setTaxLines((current) => current.map((item) => item.key === line.key ? { ...item, inputVatDeductiblePercent: Number(e.target.value) } : item))} /></div>}
                      {computed && <p className="text-xs text-[#71807a] sm:col-span-3">{t("net")}: {formatCents(computed.netAmountCents, locale)} · {t("vat")}: {formatCents(computed.vatAmountCents, locale)} · {t("gross")}: {formatCents(computed.grossAmountCents, locale)}</p>}
                    </div>;
                  })}</div>
                  <div className="grid grid-cols-3 gap-3 border-t border-[#dfe5e1] bg-[#173c32] px-4 py-3 text-white"><div><span className="text-[10px] uppercase text-white/60">{t("net")}</span><strong className="block tabular-nums">{formatCents(totals.net, locale)}</strong></div><div><span className="text-[10px] uppercase text-white/60">{t("vat")}</span><strong className="block tabular-nums">{formatCents(totals.vat, locale)}</strong></div><div><span className="text-[10px] uppercase text-white/60">{t("gross")}</span><strong className="block tabular-nums">{formatCents(totals.gross, locale)}</strong></div></div>
                </section>}

                {kind === "expense" && <div className="max-w-xs"><FieldLabel htmlFor="deductible-percent" help={tf("help.deductiblePercent")}>{tf("deductiblePercent")}</FieldLabel><Input id="deductible-percent" type="number" min={0} max={100} value={deductiblePercent} onChange={(e) => setDeductiblePercent(Number(e.target.value))} /></div>}

                <section className="grid gap-4 sm:grid-cols-2">
                  <div><FieldLabel htmlFor="entry-notes">{t("notes")}</FieldLabel><Textarea id="entry-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></div>
                  <div><FieldLabel>{t("receipts")}</FieldLabel><div className="mt-1 flex flex-col gap-1">{existingAttachments.map((attachment) => <div key={attachment.id} className="flex items-center gap-2 text-sm"><Paperclip className="size-3.5" /><a className="min-w-0 flex-1 truncate hover:underline" href={`/api/files/${attachment.id}`} target="_blank" rel="noreferrer">{attachment.fileName}</a><Button type="button" variant="ghost" size="icon-xs" onClick={() => void removeExistingAttachment(attachment.id)}><X className="size-3.5" /></Button></div>)}{pendingFiles.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 text-sm text-[#73817c]"><Upload className="size-3.5" /><span className="min-w-0 flex-1 truncate">{file.name}</span><Button type="button" variant="ghost" size="icon-xs" onClick={() => setPendingFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X className="size-3.5" /></Button></div>)}</div><input ref={fileInputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" multiple className="hidden" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); setPendingFiles((current) => [...current, ...files]); event.currentTarget.value = ""; }} /><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => fileInputRef.current?.click()}><Upload className="size-4" />{t("uploadReceipt")}</Button></div>
                </section>

                {warnings.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><h3 className="font-medium">{tf("warnings.title")}</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><div className="mt-3"><FieldLabel htmlFor="warning-reason">{tf("warnings.overrideReason")}</FieldLabel><Textarea id="warning-reason" rows={2} value={warningOverrideReason} onChange={(e) => setWarningOverrideReason(e.target.value)} placeholder={tf("warnings.overridePlaceholder")} /></div></section>}
              </div>
              <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-[#dfe5e1] bg-white/95 px-5 py-4 backdrop-blur sm:px-7">
                {entry && !isDuplicate && <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void removeEntry()}><Trash2 className="size-4" />{entry.status === "draft" ? tf("deleteDraft") : tf("voidEntry")}</Button>}
                {entry && template === "personnel" && !isDuplicate && <Button type="button" variant="outline" size="sm" disabled={pending} onClick={duplicatePersonnelMonth}>{tf("duplicatePersonnelMonth")}</Button>}
                <div className="ml-auto flex gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => void save("draft")}>{tf("saveDraft")}</Button><Button type="submit" disabled={pending || !description.trim() || totals.gross <= 0 || (warnings.length > 0 && !warningOverrideReason.trim())}>{pending && <Loader2 className="size-4 animate-spin" />}{tf("finalize")}</Button></div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
