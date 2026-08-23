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
            <>
            <div className="grid gap-3 p-3 md:hidden">
              {projects.map((project) => (
                <Link key={project.id} href={`/accounting/funding-projects/${project.id}`} className="rounded-xl border bg-background p-4 transition hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold">{project.name}</h2>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{project.fundingBody} · {project.programName || project.templateName || t("customTemplate")}</p>
                    </div>
                    <StatusBadge status={project.status} label={t(`status.${project.status}`)} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                    <div><dt className="text-muted-foreground">{t("summary.totalCost")}</dt><dd className="mt-1 font-semibold tabular-nums">{formatCents(project.totalProjectCostCents, locale)}</dd></div>
                    <div><dt className="text-muted-foreground">{t("summary.approved")}</dt><dd className="mt-1 font-semibold tabular-nums">{formatCents(project.approvedFundingCents, locale)}</dd></div>
                    <div><dt className="text-muted-foreground">{t("summary.requested")}</dt><dd className="mt-1 font-medium tabular-nums">{formatCents(project.requestedGrantCents, locale)}</dd></div>
                    <div><dt className="text-muted-foreground">{t("summary.ownFunds")}</dt><dd className="mt-1 font-medium tabular-nums">{formatCents(project.requiredOwnFundsCents, locale)}</dd></div>
                  </dl>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
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
            </div>
            </>
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
