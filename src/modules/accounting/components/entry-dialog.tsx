"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Paperclip, Trash2, Upload, X } from "lucide-react";
import { formatCents, parseAmountToCents } from "@/lib/money";
import {
  deleteEntry,
  upsertEntry,
  type EntryInput,
} from "@/modules/accounting/actions";
import type { EntryRow } from "@/modules/accounting/queries";
import type { categories as categoriesTable } from "@/modules/accounting/schema";
import { breakdownFromGross, isVatRate, VAT_RATES } from "../lib/vat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Category = typeof categoriesTable.$inferSelect;

type AttachmentDto = { id: string; fileName: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function EntryDialog({
  open,
  onOpenChange,
  entry,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: EntryRow | null;
  categories: Category[];
}) {
  const t = useTranslations("accounting");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amountText, setAmountText] = useState("");
  const [vatRate, setVatRate] = useState(20);
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "cash" | "card">(
    "bank",
  );
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [existingAttachments, setExistingAttachments] = useState<
    AttachmentDto[]
  >([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Reset form state when the dialog opens for a different entry
  // (render-time state adjustment — see react.dev "you might not need an effect").
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? (entry?.id ?? "new") : null;
  if (syncKey !== currentKey) {
    setSyncKey(currentKey);
    if (currentKey !== null) {
      setKind(entry?.kind ?? "expense");
      setDate(entry?.date ?? todayIso());
      setDescription(entry?.description ?? "");
      setCounterparty(entry?.counterparty ?? "");
      setCategoryId(entry?.categoryId ?? "");
      setAmountText(
        entry ? (entry.grossAmountCents / 100).toFixed(2).replace(".", ",") : "",
      );
      setVatRate(entry?.vatRate ?? 20);
      setPaymentMethod(entry?.paymentMethod ?? "bank");
      setNotes(entry?.notes ?? "");
      setExistingAttachments([]);
      setPendingFiles([]);
    }
  }

  // Load existing receipts from the server whenever an entry is opened.
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

  const kindCategories = categories.filter((c) => c.kind === kind);
  const grossCents = parseAmountToCents(amountText);
  const breakdown = useMemo(() => {
    if (grossCents === null || grossCents <= 0 || !isVatRate(vatRate)) {
      return null;
    }
    return breakdownFromGross(grossCents, vatRate);
  }, [grossCents, vatRate]);

  async function uploadFiles(entryId: string) {
    for (const file of pendingFiles) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("entityType", "entry");
      formData.append("entityId", entryId);
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) toast.error(`${t("uploadFailed")}: ${file.name}`);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!breakdown || !categoryId) return;
    setPending(true);
    try {
      const input: EntryInput = {
        id: entry?.id,
        kind,
        date,
        description,
        counterparty,
        categoryId,
        grossAmountCents: breakdown.grossCents,
        vatRate: vatRate as EntryInput["vatRate"],
        paymentMethod,
        notes,
      };
      const { id } = await upsertEntry(input);
      if (pendingFiles.length > 0) await uploadFiles(id);
      toast.success(tCommon("saved"));
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  async function onDelete() {
    if (!entry) return;
    if (!window.confirm(tCommon("confirmDeleteTitle"))) return;
    setPending(true);
    try {
      await deleteEntry(entry.id);
      toast.success(tCommon("saved"));
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  async function removeExistingAttachment(id: string) {
    const response = await fetch(`/api/files/${id}`, { method: "DELETE" });
    if (response.ok) {
      setExistingAttachments((current) =>
        current.filter((attachment) => attachment.id !== id),
      );
      router.refresh();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? t("editEntry") : t("newEntry")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Tabs
            value={kind}
            onValueChange={(value) => {
              setKind(value as "income" | "expense");
              setCategoryId("");
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="expense" className="flex-1">
                {t("expense")}
              </TabsTrigger>
              <TabsTrigger value="income" className="flex-1">
                {t("income")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-date">{t("date")}</Label>
              <Input
                id="entry-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("paymentMethod")}</Label>
              <Select
                value={paymentMethod}
                onValueChange={(value) =>
                  setPaymentMethod(value as typeof paymentMethod)
                }
              >
                <SelectTrigger>
                  <SelectValue>{t(paymentMethod)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">{t("bank")}</SelectItem>
                  <SelectItem value="cash">{t("cash")}</SelectItem>
                  <SelectItem value="card">{t("card")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-description">{t("description")}</Label>
            <Input
              id="entry-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              maxLength={500}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-counterparty">{t("counterparty")}</Label>
              <Input
                id="entry-counterparty"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("category")}</Label>
              <Select
                value={categoryId}
                onValueChange={(value) => setCategoryId(value ?? "")}
              >
                <SelectTrigger
                  aria-invalid={!categoryId}
                  className="w-full"
                  id="entry-category"
                >
                  <SelectValue>
                    {kindCategories.find((c) => c.id === categoryId)?.name ?? ""}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {kindCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      <span
                        className="mr-1 inline-block size-2 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="entry-amount">{t("amountGross")}</Label>
              <Input
                id="entry-amount"
                inputMode="decimal"
                placeholder="0,00"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-invalid={amountText !== "" && grossCents === null}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("vatRate")}</Label>
              <Select
                value={String(vatRate)}
                onValueChange={(value) => setVatRate(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue>{vatRate} %</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {VAT_RATES.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>
                      {rate} %
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {breakdown && (
            <p className="text-sm text-muted-foreground">
              {t("net")}: {formatCents(breakdown.netCents, locale)} · {t("vat")}
              : {formatCents(breakdown.vatCents, locale)} · {t("gross")}:{" "}
              {formatCents(breakdown.grossCents, locale)}
            </p>
          )}
          {amountText !== "" && grossCents === null && (
            <p className="text-sm text-destructive">{t("invalidAmount")}</p>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="entry-notes">{t("notes")}</Label>
            <Textarea
              id="entry-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t("receipts")}</Label>
            <div className="flex flex-col gap-1">
              {existingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <Paperclip className="size-3.5 text-muted-foreground" />
                  <a
                    href={`/api/files/${attachment.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate underline-offset-2 hover:underline"
                  >
                    {attachment.fileName}
                  </a>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeExistingAttachment(attachment.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              {pendingFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Upload className="size-3.5" />
                  <span className="flex-1 truncate">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                      setPendingFiles((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setPendingFiles((current) => [...current, ...files]);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" />
              {t("uploadReceipt")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            {entry ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onDelete}
                disabled={pending}
              >
                <Trash2 className="size-4" />
                {t("deleteEntry")}
              </Button>
            ) : (
              <span />
            )}
            <Button
              type="submit"
              disabled={pending || !breakdown || !categoryId}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {tCommon("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
