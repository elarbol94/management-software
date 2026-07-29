"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteCategory,
  setCategoryArchived,
  upsertCategory,
} from "@/modules/accounting/actions";
import type { categories as categoriesTable } from "@/modules/accounting/schema";
import { categoryTemplates, type CategoryTemplate } from "@/modules/accounting/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Category = typeof categoriesTable.$inferSelect;

export function CategoriesManager({ categories }: { categories: Category[] }) {
  const t = useTranslations("settings.categories");
  const tAccounting = useTranslations("accounting");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [color, setColor] = useState("#64748b");
  const [template, setTemplate] = useState<CategoryTemplate>("standard_expense");
  const [pending, setPending] = useState(false);

  function openDialog(category: Category | null) {
    setEditing(category);
    setName(category?.name ?? "");
    setKind(category?.kind ?? "expense");
    setColor(category?.color ?? "#64748b");
    setTemplate(
      category?.template ??
        (category?.kind === "income" ? "standard_income" : "standard_expense"),
    );
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await upsertCategory({ id: editing?.id, name, kind, color, template });
      toast.success(tCommon("saved"));
      setDialogOpen(false);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  async function onDelete(category: Category) {
    if (!window.confirm(tCommon("confirmDeleteTitle"))) return;
    try {
      const { deleted } = await deleteCategory(category.id);
      if (!deleted) {
        await setCategoryArchived(category.id, true);
        toast.info(t("inUse"));
      } else {
        toast.success(tCommon("deleted"));
      }
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    }
  }

  async function toggleArchived(category: Category) {
    try {
      await setCategoryArchived(category.id, !category.archived);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    }
  }

  const grouped: Array<{ kind: "income" | "expense"; items: Category[] }> = [
    { kind: "income", items: categories.filter((c) => c.kind === "income") },
    { kind: "expense", items: categories.filter((c) => c.kind === "expense") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Button size="sm" className="self-start" onClick={() => openDialog(null)}>
        <Plus className="size-4" />
        {t("addCategory")}
      </Button>

      {grouped.map((group) => (
        <div key={group.kind} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {group.kind === "income"
              ? tAccounting("incomePlural")
              : tAccounting("expensePlural")}
          </h3>
          <div className="flex flex-col divide-y rounded-md border">
            {group.items.map((category) => (
              <div
                key={category.id}
                className="flex items-center gap-3 px-3 py-2"
              >
                <span
                  className="inline-block size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                <span
                  className={`flex-1 text-sm ${
                    category.archived ? "text-muted-foreground line-through" : ""
                  }`}
                >
                  {category.name}
                </span>
                <Badge variant="outline">{t(`templates.${category.template}`)}</Badge>
                {category.archived && (
                  <Badge variant="secondary">{t("archived")}</Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={tCommon("edit")}
                  onClick={() => openDialog(category)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={category.archived ? t("unarchive") : t("archive")}
                  aria-label={category.archived ? t("unarchive") : t("archive")}
                  onClick={() => toggleArchived(category)}
                >
                  {category.archived ? (
                    <ArchiveRestore className="size-3.5" />
                  ) : (
                    <Archive className="size-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={tCommon("delete")}
                  onClick={() => onDelete(category)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("editCategory") : t("addCategory")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="category-name">{t("name")}</Label>
              <Input
                id="category-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={100}
              />
            </div>
            {!editing && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="category-kind">{t("kind")}</Label>
                <Select
                  value={kind}
                  onValueChange={(value) => {
                    const nextKind = value as typeof kind;
                    setKind(nextKind);
                    setTemplate(
                      nextKind === "income" ? "standard_income" : "standard_expense",
                    );
                  }}
                >
                  <SelectTrigger id="category-kind">
                    <SelectValue>
                      {kind === "income"
                        ? tAccounting("income")
                        : tAccounting("expense")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">
                      {tAccounting("income")}
                    </SelectItem>
                    <SelectItem value="expense">
                      {tAccounting("expense")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="category-template">{t("template")}</Label>
              <Select
                value={template}
                onValueChange={(value) => setTemplate(value as CategoryTemplate)}
              >
                <SelectTrigger id="category-template">
                  <SelectValue>{t(`templates.${template}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categoryTemplates
                    .filter((item) =>
                      kind === "income"
                        ? item === "standard_income" || item === "grant_income"
                        : item !== "standard_income" && item !== "grant_income",
                    )
                    .map((item) => (
                      <SelectItem key={item} value={item}>
                        {t(`templates.${item}`)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="category-color">{t("color")}</Label>
              <input
                id="category-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-16 cursor-pointer rounded-md border bg-background p-1"
              />
            </div>
            <Button type="submit" disabled={pending}>
              {tCommon("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
