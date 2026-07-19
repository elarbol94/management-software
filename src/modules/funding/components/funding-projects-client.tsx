"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Landmark, Plus } from "lucide-react";
import { formatCents } from "@/lib/money";
import type { FundingProjectListRow } from "@/modules/funding/queries";
import { FundingProjectDialog } from "./project-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function FundingProjectsClient({
  projects,
  templates,
}: {
  projects: FundingProjectListRow[];
  templates: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations("fundingProjects");
  const locale = useLocale();
  const [dialogOpen, setDialogOpen] = useState(false);
  const totals = useMemo(
    () =>
      projects.reduce(
        (sum, project) => ({
          costs: sum.costs + project.totalProjectCostCents,
          requested: sum.requested + project.requestedGrantCents,
          approved: sum.approved + project.approvedFundingCents,
        }),
        { costs: 0, requested: 0, approved: 0 },
      ),
    [projects],
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
          {t("newProject")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label={t("summary.totalCost")} value={formatCents(totals.costs, locale)} />
        <SummaryCard label={t("summary.requested")} value={formatCents(totals.requested, locale)} />
        <SummaryCard label={t("summary.approved")} value={formatCents(totals.approved, locale)} />
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="size-4 text-muted-foreground" />
            {t("portfolio")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <div className="grid place-items-center gap-2 px-6 py-16 text-center">
              <Landmark className="size-8 text-muted-foreground" />
              <p className="font-medium">{t("empty.title")}</p>
              <p className="max-w-md text-sm text-muted-foreground">{t("empty.description")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fields.name")}</TableHead>
                  <TableHead>{t("fields.fundingBody")}</TableHead>
                  <TableHead>{t("fields.status")}</TableHead>
                  <TableHead className="text-right">{t("summary.totalCost")}</TableHead>
                  <TableHead className="text-right">{t("summary.requested")}</TableHead>
                  <TableHead className="text-right">{t("summary.approved")}</TableHead>
                  <TableHead className="text-right">{t("summary.ownFunds")}</TableHead>
                  <TableHead><span className="sr-only">{t("openProject")}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <div className="min-w-48">
                        <Link href={`/accounting/funding-projects/${project.id}`} className="font-medium hover:underline">
                          {project.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{project.programName || project.templateName || t("customTemplate")}</p>
                      </div>
                    </TableCell>
                    <TableCell>{project.fundingBody}</TableCell>
                    <TableCell><StatusBadge status={project.status} label={t(`status.${project.status}`)} /></TableCell>
                    <MoneyCell value={project.totalProjectCostCents} locale={locale} />
                    <MoneyCell value={project.requestedGrantCents} locale={locale} />
                    <MoneyCell value={project.approvedFundingCents} locale={locale} />
                    <MoneyCell value={project.requiredOwnFundsCents} locale={locale} />
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" render={<Link href={`/accounting/funding-projects/${project.id}`} aria-label={t("openProject")} />}>
                        <ArrowRight className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <FundingProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} project={null} templates={templates} />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="px-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function MoneyCell({ value, locale }: { value: number; locale: string }) {
  return <TableCell className="text-right font-medium tabular-nums">{formatCents(value, locale)}</TableCell>;
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const variant = status === "rejected" ? "destructive" : status === "active" || status === "approved" ? "default" : "secondary";
  return <Badge variant={variant}>{label}</Badge>;
}
