"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, FolderTree, Highlighter, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CategoryEvidence, CategoryRow } from "../category-queries";
import { createCategory, deleteCategory, moveEvidenceToCategory, renameCategory } from "../category-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EvidencePanel } from "./evidence-panel";

type Category = CategoryRow & { depth: number };

export function CategoryWorkspace({ categories, selectedId, evidence }: {
  categories: Category[];
  selectedId: string;
  evidence: CategoryEvidence[];
}) {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = categories.find((category) => category.id === selectedId);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("categories.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addCategory(parentId: string | null) {
    const name = draftName.trim() || t("categories.untitled");
    await run(async () => {
      const created = await createCategory({ name, parentId });
      setDraftName("");
      router.push(`/wiki/categories?id=${created.id}`);
    });
  }

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div className="flex items-center gap-2">
          <FolderTree className="size-4 text-indigo-500" />
          <h1 className="text-sm font-semibold">{t("categories.title")}</h1>
        </div>
        <p className="text-xs text-muted-foreground">{t("categories.description")}</p>

        <form
          className="flex gap-1.5"
          onSubmit={(event) => { event.preventDefault(); void addCategory(null); }}
        >
          <Input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={t("categories.newPlaceholder")}
            aria-label={t("categories.newPlaceholder")}
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={busy}><Plus className="size-4" /></Button>
        </form>

        {categories.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">{t("categories.empty")}</p>
        ) : (
          <nav className="divide-y rounded-lg border" aria-label={t("categories.title")}>
            {categories.map((category) => (
              <div key={category.id} className="flex items-center gap-1" style={{ paddingLeft: `${4 + category.depth * 14}px` }}>
                <Link
                  href={`/wiki/categories?id=${category.id}`}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-sm ${category.id === selectedId ? "font-medium text-indigo-700 dark:text-indigo-300" : "hover:text-foreground"}`}
                >
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground tabular-nums">{category.evidenceCount}</span>
                </Link>
                <Button
                  type="button" size="icon-sm" variant="ghost" disabled={busy}
                  title={t("categories.addChild")} aria-label={t("categories.addChild")}
                  onClick={() => void addCategory(category.id)}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            ))}
          </nav>
        )}
      </aside>

      <section className="min-w-0 space-y-4">
        {!selected ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t("categories.selectPrompt")}</p>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-2 border-b pb-3">
              <Input
                key={selected.id}
                defaultValue={selected.name}
                aria-label={t("categories.rename")}
                className="h-9 max-w-md text-base font-medium"
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (!name || name === selected.name) return;
                  void run(() => renameCategory({ id: selected.id, name }));
                }}
              />
              <span className="text-xs text-muted-foreground">{t("categories.evidenceCount", { count: evidence.length })}</span>
              <Button
                type="button" size="xs" variant="ghost" disabled={busy}
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => {
                  if (!confirm(t("categories.deleteConfirm"))) return;
                  void run(async () => { await deleteCategory(selected.id); router.push("/wiki/categories"); });
                }}
              >
                <Trash2 className="size-3.5" />{t("delete")}
              </Button>
            </header>

            {/* The same panel every other evidence target uses, so filing a passage under
                an outline entry works exactly like linking it to a project or invoice. */}
            <EvidencePanel targetType="wikiCategory" targetId={selected.id} compact />

            {evidence.length === 0 ? (
              <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{t("categories.noEvidence")}</p>
            ) : (
              <ul className="space-y-3">
                {evidence.map((item) => (
                  <li key={item.linkId} className="rounded-xl border bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Highlighter className="size-4 shrink-0 text-fuchsia-600" />
                      <Link
                        href={`/wiki/sources/${item.sourceId}/read/${item.documentId}?page=${item.pageNumber}&annotation=${item.annotationId}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {item.sourceTitle}
                      </Link>
                      <span className="text-xs text-muted-foreground">{t("pageNumber", { page: item.pageNumber })}</span>
                      {categories.length > 1 && (
                        <Select
                          value={selected.id}
                          onValueChange={(value) => {
                            if (!value || value === selected.id) return;
                            void run(() => moveEvidenceToCategory({ linkId: item.linkId, categoryId: value }));
                          }}
                        >
                          <SelectTrigger aria-label={t("categories.moveTo")} className="ml-auto h-7 w-48 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {item.selectedText && <blockquote className="mt-2 border-l-2 pl-3 text-sm italic text-muted-foreground">“{item.selectedText}”</blockquote>}
                    {item.note && <p className="mt-2 text-sm">{item.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
