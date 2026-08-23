"use client";

import { createId } from "@paralleldrive/cuid2";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { BarChart3, FolderKanban, Map, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createMunicipalityAnalysis,
  listMyMunicipalityAnalyses,
} from "../actions";
import { ANALYSIS_OPERATION_VERSION, municipalityDatasetRefSchema, type MunicipalityDatasetRef } from "../analysis";
import type { MunicipalityAnalysisSummary } from "../queries";
import { useMunicipalityAnalysisPersistence } from "./municipality-analysis-persistence-provider";
import {
  MUNICIPALITY_DATASET_DRAG_TYPE,
  MUNICIPALITY_DATASET_TRANSFER_EVENT,
  readMunicipalityDatasetDrag,
} from "../transfer";

export function MunicipalitiesSubnav() {
  const t = useTranslations("municipalities");
  const pathname = usePathname();
  const { enqueue } = useMunicipalityAnalysisPersistence();
  const [dragging, setDragging] = useState(false);
  const [dataset, setDataset] = useState<MunicipalityDatasetRef | null>(null);
  const [analyses, setAnalyses] = useState<MunicipalityAnalysisSummary[]>([]);
  const [lastAnalysisId, setLastAnalysisId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [loading, startTransition] = useTransition();

  useEffect(() => {
    const listener = (event: Event) => {
      const parsed = municipalityDatasetRefSchema.safeParse((event as CustomEvent).detail);
      if (parsed.success) setDataset(parsed.data);
    };
    window.addEventListener(MUNICIPALITY_DATASET_TRANSFER_EVENT, listener);
    return () => window.removeEventListener(MUNICIPALITY_DATASET_TRANSFER_EVENT, listener);
  }, []);

  useEffect(() => {
    if (!dataset) return;
    startTransition(async () => setAnalyses(await listMyMunicipalityAnalyses()));
  }, [dataset]);

  function finishTransfer(analysisId: string) {
    setLastAnalysisId(analysisId);
    setDataset(null);
    setName("");
    toast.success(t("analysisSaved"));
  }

  function addToExisting(analysisId: string) {
    if (!dataset) return;
    enqueue(analysisId, [{
      version: ANALYSIS_OPERATION_VERSION,
      type: "add-dataset",
      nodeId: createId(),
      dataset,
    }]);
    finishTransfer(analysisId);
  }

  function createAnalysis() {
    if (!dataset || !name.trim()) return;
    startTransition(async () => {
      const result = await createMunicipalityAnalysis({ name, dataset });
      finishTransfer(result.id);
    });
  }

  return (
    <>
      <nav className="flex items-center gap-1 rounded-xl border bg-muted/35 p-1" aria-label={t("subnavLabel")}>
        <Link
          href="/municipalities/overview"
          aria-label={t("overviewTab")}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
            pathname.endsWith("/overview") ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
          )}
          aria-current={pathname.endsWith("/overview") ? "page" : undefined}
        >
          <Map className="size-4" />
          <span className="hidden sm:inline">{t("overviewTab")}</span>
        </Link>
        <Link
          href={lastAnalysisId ? "/municipalities/analysis?analysis=" + encodeURIComponent(lastAnalysisId) : "/municipalities/analysis"}
          prefetch={false}
          aria-label={t("analysisTab")}
          data-testid="municipality-analysis-drop-target"
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-lg border border-transparent px-3 text-sm font-medium transition-all",
            pathname.endsWith("/analysis") ? "bg-background shadow-sm" : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            dragging && "border-teal-600 bg-teal-50 text-teal-800 ring-2 ring-teal-600/25 dark:bg-teal-950 dark:text-teal-200",
          )}
          aria-current={pathname.endsWith("/analysis") ? "page" : undefined}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes(MUNICIPALITY_DATASET_DRAG_TYPE)) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(MUNICIPALITY_DATASET_DRAG_TYPE)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            try {
              const value = readMunicipalityDatasetDrag(event);
              if (value) setDataset(value);
            } catch {
              setDataset(null);
            }
          }}
        >
          <BarChart3 className="size-4" />
          <span className="hidden sm:inline">{dragging ? t("dropOnAnalysis") : t("analysisTab")}</span>
        </Link>
      </nav>

      <Dialog open={Boolean(dataset)} onOpenChange={(open) => { if (!open) setDataset(null); }}>
        <DialogContent className="sm:max-w-lg" data-testid="municipality-analysis-picker">
          <DialogHeader>
            <DialogTitle>{t("chooseAnalysisTitle")}</DialogTitle>
            <DialogDescription>{t("chooseAnalysisDescription", { municipality: dataset?.municipalityName ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-56 gap-2 overflow-y-auto">
            {analyses.length ? analyses.map((analysis) => (
              <Button
                key={analysis.id}
                variant="outline"
                className="h-auto justify-start px-3 py-2 text-left"
                disabled={loading}
                onClick={() => addToExisting(analysis.id)}
              >
                <FolderKanban className="size-4" />
                <span className="min-w-0 truncate">{analysis.name}</span>
              </Button>
            )) : (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                {loading ? t("analysesLoading") : t("noAnalyses")}
              </p>
            )}
          </div>
          <div className="grid gap-2 border-t pt-4">
            <label htmlFor="new-municipality-analysis" className="text-sm font-medium">{t("newAnalysis")}</label>
            <div className="flex gap-2">
              <Input
                id="new-municipality-analysis"
                value={name}
                maxLength={120}
                placeholder={t("analysisNamePlaceholder")}
                onValueChange={(value) => setName(value)}
                onKeyDown={(event) => { if (event.key === "Enter") createAnalysis(); }}
              />
              <Button disabled={loading || !name.trim()} onClick={createAnalysis}>
                <Plus className="size-4" />
                {t("create")}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDataset(null)}>{t("cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
