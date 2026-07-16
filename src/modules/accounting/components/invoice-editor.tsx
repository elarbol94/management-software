"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { upsertInvoice, type InvoiceInput } from "@/modules/accounting/invoice-actions";
import { computeInvoiceTotals, type InvoiceItemInput } from "@/modules/accounting/lib/invoice";
import { VAT_RATES } from "@/modules/accounting/lib/vat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type CustomerRef = { id: string; name: string };

type ItemDraft = {
  description: string;
  quantityText: string;
  unitPriceText: string;
  vatRate: number;
};

export type InvoiceEditorInitial = {
  id: string;
  customerId: string;
  issueDate: string;
  dueDate: string | null;
  notes: string;
  items: Array<{
    description: string;
    quantityThousandths: number;
    unitPriceCents: number;
    vatRate: number;
  }>;
} | null;

function parseQuantity(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null;
  const value = Math.round(parseFloat(normalized) * 1000);
  return value > 0 ? value : null;
}

function formatQuantity(thousandths: number): string {
  return (thousandths / 1000).toString().replace(".", ",");
}

export function InvoiceEditor({
  customers,
  initial,
  defaultVatRate,
}: {
  customers: CustomerRef[];
  initial: InvoiceEditorInitial;
  defaultVatRate: number;
}) {
  const t = useTranslations("invoices");
  const tAccounting = useTranslations("accounting");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<ItemDraft[]>(
    initial?.items.map((item) => ({
      description: item.description,
      quantityText: formatQuantity(item.quantityThousandths),
      unitPriceText: (item.unitPriceCents / 100).toFixed(2).replace(".", ","),
      vatRate: item.vatRate,
    })) ?? [
      {
        description: "",
        quantityText: "1",
        unitPriceText: "",
        vatRate: defaultVatRate,
      },
    ],
  );
  const [pending, setPending] = useState(false);

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  const parsedItems: Array<InvoiceItemInput | null> = items.map((item) => {
    const quantityThousandths = parseQuantity(item.quantityText);
    const unitPriceCents = parseAmountToCents(item.unitPriceText);
    if (
      !item.description.trim() ||
      quantityThousandths === null ||
      unitPriceCents === null ||
      unitPriceCents < 0
    ) {
      return null;
    }
    return {
      description: item.description.trim(),
      quantityThousandths,
      unitPriceCents,
      vatRate: item.vatRate,
    };
  });

  const allValid =
    parsedItems.length > 0 && parsedItems.every((item) => item !== null);
  const totals = useMemo(() => {
    if (!allValid) return null;
    try {
      return computeInvoiceTotals(parsedItems as InvoiceItemInput[]);
    } catch {
      return null;
    }
  }, [allValid, parsedItems]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allValid || !customerId) return;
    setPending(true);
    try {
      const input: InvoiceInput = {
        id: initial?.id,
        customerId,
        issueDate,
        dueDate: dueDate || null,
        notes,
        items: parsedItems as InvoiceItemInput[],
      };
      const { id } = await upsertInvoice(input);
      toast.success(tCommon("saved"));
      router.push(`/accounting/invoices/${id}`);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label>{t("customer")}</Label>
          <Select
            value={customerId}
            onValueChange={(value) => setCustomerId(value ?? "")}
          >
            <SelectTrigger className="w-full" id="invoice-customer">
              <SelectValue>
                {customers.find((c) => c.id === customerId)?.name ?? ""}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {customers.map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-issue-date">{t("issueDate")}</Label>
          <Input
            id="invoice-issue-date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invoice-due-date">{t("dueDate")}</Label>
          <Input
            id="invoice-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t("items")}</Label>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_90px_120px_90px_100px_32px] items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span>{t("itemDescription")}</span>
            <span>{t("quantity")}</span>
            <span>{t("unitPrice")}</span>
            <span>{tAccounting("vat")}</span>
            <span className="text-right">{t("lineTotal")}</span>
            <span />
          </div>
          {items.map((item, index) => {
            const parsed = parsedItems[index];
            return (
              <div
                key={index}
                className="grid grid-cols-[1fr_90px_120px_90px_100px_32px] items-center gap-2"
              >
                <Input
                  value={item.description}
                  onChange={(e) => updateItem(index, { description: e.target.value })}
                  placeholder={t("itemDescription")}
                  data-testid={`item-description-${index}`}
                />
                <Input
                  value={item.quantityText}
                  onChange={(e) => updateItem(index, { quantityText: e.target.value })}
                  inputMode="decimal"
                  data-testid={`item-quantity-${index}`}
                />
                <Input
                  value={item.unitPriceText}
                  onChange={(e) => updateItem(index, { unitPriceText: e.target.value })}
                  inputMode="decimal"
                  placeholder="0,00"
                  data-testid={`item-price-${index}`}
                />
                <Select
                  value={String(item.vatRate)}
                  onValueChange={(value) =>
                    updateItem(index, { vatRate: Number(value) })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>{item.vatRate} %</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        {rate} %
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-right text-sm tabular-nums">
                  {parsed
                    ? formatCents(
                        Math.floor(
                          (parsed.quantityThousandths * parsed.unitPriceCents) /
                            1000 +
                            0.5,
                        ),
                        locale,
                      )
                    : "–"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={items.length === 1}
                  onClick={() =>
                    setItems((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            setItems((current) => [
              ...current,
              {
                description: "",
                quantityText: "1",
                unitPriceText: "",
                vatRate: defaultVatRate,
              },
            ])
          }
        >
          <Plus className="size-4" />
          {t("addItem")}
        </Button>
      </div>

      {totals && (
        <div className="flex flex-col items-end gap-1 text-sm">
          <span>
            {t("subtotal")}:{" "}
            <span className="tabular-nums">{formatCents(totals.netCents, locale)}</span>
          </span>
          {totals.byRate
            .filter((group) => group.vatRate > 0)
            .map((group) => (
              <span key={group.vatRate}>
                {t("vatAmount", { rate: group.vatRate })}:{" "}
                <span className="tabular-nums">
                  {formatCents(group.vatCents, locale)}
                </span>
              </span>
            ))}
          <span className="text-base font-semibold">
            {t("total")}:{" "}
            <span className="tabular-nums">
              {formatCents(totals.grossCents, locale)}
            </span>
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="invoice-notes">{t("notes")}</Label>
        <Textarea
          id="invoice-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
        />
      </div>

      <Button
        type="submit"
        disabled={pending || !allValid || !customerId}
        className="self-start"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {tCommon("save")}
      </Button>
    </form>
  );
}
