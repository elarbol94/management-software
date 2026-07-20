"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  upsertFundingProject,
  type FundingProjectInput,
} from "@/modules/funding/actions";
import { parseAmountToCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type TemplateOption = { id: string; name: string };
type EditableProject = FundingProjectInput & { id: string };

const emptyProject: FundingProjectInput = {
  templateId: null,
  programName: "",
  fundingBody: "",
  name: "",
  submissionDeadline: null,
  plannedSubmissionDate: null,
  projectStart: null,
  projectEnd: null,
  status: "planning",
  fundingRateBasisPoints: 0,
  fundingCapCents: null,
  approvedFundingCents: 0,
  contactName: "",
  contactEmail: "",
  fundingNumber: "",
  vatDeductible: false,
  deMinimisRelevant: false,
  otherAidCents: 0,
  notes: "",
};

const inputClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

function moneyText(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

function toNullable(value: string) {
  return value || null;
}

export function FundingProjectDialog({
  open,
  onOpenChange,
  project,
  templates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: EditableProject | null;
  templates: TemplateOption[];
}) {
  const t = useTranslations("fundingProjects");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [value, setValue] = useState<FundingProjectInput>(emptyProject);
  const [fundingRate, setFundingRate] = useState("0");
  const [fundingCap, setFundingCap] = useState("");
  const [approvedFunding, setApprovedFunding] = useState("0,00");
  const [otherAid, setOtherAid] = useState("0,00");
  const [pending, setPending] = useState(false);
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? (project?.id ?? "new") : null;

  if (syncKey !== currentKey) {
    setSyncKey(currentKey);
    if (currentKey !== null) {
      const next = project ?? emptyProject;
      setValue(next);
      setFundingRate((next.fundingRateBasisPoints / 100).toFixed(2).replace(".", ","));
      setFundingCap(moneyText(next.fundingCapCents));
      setApprovedFunding(moneyText(next.approvedFundingCents));
      setOtherAid(moneyText(next.otherAidCents));
    }
  }

  function set<K extends keyof FundingProjectInput>(
    key: K,
    next: FundingProjectInput[K],
  ) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const rate = Number(fundingRate.replace(",", "."));
    const cap = fundingCap ? parseAmountToCents(fundingCap) : null;
    const approved = parseAmountToCents(approvedFunding);
    const aid = parseAmountToCents(otherAid);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100 || cap === null && fundingCap || approved === null || aid === null) {
      toast.error(t("validation.money"));
      return;
    }
    setPending(true);
    try {
      const result = await upsertFundingProject({
        ...value,
        id: project?.id,
        fundingRateBasisPoints: Math.round(rate * 100),
        fundingCapCents: cap,
        approvedFundingCents: approved,
        otherAidCents: aid,
      });
      toast.success(tCommon("saved"));
      onOpenChange(false);
      router.refresh();
      if (!project) router.push(`/accounting/funding-projects/${result.id}`);
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{project ? t("editProject") : t("newProject")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="funding-name">{t("fields.name")}</Label>
              <Input
                id="funding-name"
                value={value.name}
                onChange={(event) => set("name", event.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="funding-template">{t("fields.template")}</Label>
              <select
                id="funding-template"
                className={inputClass}
                value={value.templateId ?? ""}
                onChange={(event) => set("templateId", toNullable(event.target.value))}
              >
                <option value="">{t("customTemplate")}</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="funding-program">{t("fields.programName")}</Label>
              <Input id="funding-program" value={value.programName} onChange={(event) => set("programName", event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="funding-body">{t("fields.fundingBody")}</Label>
              <Input id="funding-body" value={value.fundingBody} onChange={(event) => set("fundingBody", event.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="funding-status">{t("fields.status")}</Label>
              <select id="funding-status" className={inputClass} value={value.status} onChange={(event) => set("status", event.target.value as FundingProjectInput["status"])}>
                {(["planning", "preparing", "submitted", "approved", "active", "completed", "rejected"] as const).map((status) => (
                  <option key={status} value={status}>{t(`status.${status}`)}</option>
                ))}
              </select>
            </div>
            <DateField id="submission-deadline" label={t("fields.submissionDeadline")} value={value.submissionDeadline} onChange={(next) => set("submissionDeadline", next)} />
            <DateField id="planned-submission" label={t("fields.plannedSubmission")} value={value.plannedSubmissionDate} onChange={(next) => set("plannedSubmissionDate", next)} />
            <DateField id="project-start" label={t("fields.projectStart")} value={value.projectStart} onChange={(next) => set("projectStart", next)} />
            <DateField id="project-end" label={t("fields.projectEnd")} value={value.projectEnd} onChange={(next) => set("projectEnd", next)} />
            <div className="grid gap-2">
              <Label htmlFor="funding-rate">{t("fields.fundingRate")}</Label>
              <Input id="funding-rate" inputMode="decimal" value={fundingRate} onChange={(event) => setFundingRate(event.target.value)} />
            </div>
            <MoneyField id="funding-cap" label={t("fields.fundingCap")} value={fundingCap} onChange={setFundingCap} />
            <MoneyField id="approved-funding" label={t("fields.approvedFunding")} value={approvedFunding} onChange={setApprovedFunding} />
            <MoneyField id="other-aid" label={t("fields.otherAid")} value={otherAid} onChange={setOtherAid} />
            <div className="grid gap-2">
              <Label htmlFor="funding-contact">{t("fields.contact")}</Label>
              <Input id="funding-contact" value={value.contactName} onChange={(event) => set("contactName", event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="funding-email">{t("fields.contactEmail")}</Label>
              <Input id="funding-email" type="email" value={value.contactEmail} onChange={(event) => set("contactEmail", event.target.value)} />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="funding-number">{t("fields.fundingNumber")}</Label>
              <Input id="funding-number" value={value.fundingNumber} onChange={(event) => set("fundingNumber", event.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={value.vatDeductible} onChange={(event) => set("vatDeductible", event.target.checked)} className="size-4 rounded border-input" />
              {t("fields.vatDeductible")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={value.deMinimisRelevant} onChange={(event) => set("deMinimisRelevant", event.target.checked)} className="size-4 rounded border-input" />
              {t("fields.deMinimis")}
            </label>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="funding-notes">{t("fields.notes")}</Label>
              <Textarea id="funding-notes" value={value.notes} onChange={(event) => set("notes", event.target.value)} rows={3} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("templateDisclaimer")}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />}
              {tCommon("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DateField({ id, label, value, onChange }: { id: string; label: string; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="date" value={value ?? ""} onChange={(event) => onChange(toNullable(event.target.value))} />
    </div>
  );
}

function MoneyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} className="pr-8 text-right tabular-nums" />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">€</span>
      </div>
    </div>
  );
}
