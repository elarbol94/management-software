"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { updateAppSettings, type SettingsInput } from "@/modules/settings/actions";
import type { AppSettings } from "@/modules/settings/queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const VAT_RATES = [20, 13, 10, 0] as const;

export function CompanyForm({ settings }: { settings: AppSettings }) {
  const t = useTranslations("settings.company");
  const tCommon = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<SettingsInput>({
    companyName: settings.companyName,
    address: settings.address,
    uid: settings.uid,
    iban: settings.iban,
    bic: settings.bic,
    kleinunternehmer: settings.kleinunternehmer,
    invoicePrefix: settings.invoicePrefix,
    defaultVatRate: settings.defaultVatRate as SettingsInput["defaultVatRate"],
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateAppSettings(form);
        toast.success(tCommon("saved"));
      } catch {
        toast.error(tCommon("error"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="companyName">{t("companyName")}</Label>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="address">{t("address")}</Label>
            <Textarea
              id="address"
              rows={3}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="uid">{t("uid")}</Label>
              <Input
                id="uid"
                placeholder="ATU12345678"
                value={form.uid}
                onChange={(e) => setForm({ ...form, uid: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invoicePrefix">{t("invoicePrefix")}</Label>
              <Input
                id="invoicePrefix"
                placeholder="RE-"
                value={form.invoicePrefix}
                onChange={(e) =>
                  setForm({ ...form, invoicePrefix: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="iban">{t("iban")}</Label>
              <Input
                id="iban"
                value={form.iban}
                onChange={(e) => setForm({ ...form, iban: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="bic">{t("bic")}</Label>
              <Input
                id="bic"
                value={form.bic}
                onChange={(e) => setForm({ ...form, bic: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="default-vat-rate">{t("defaultVatRate")}</Label>
            <Select
              value={String(form.defaultVatRate)}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  defaultVatRate: Number(value) as SettingsInput["defaultVatRate"],
                })
              }
            >
              <SelectTrigger id="default-vat-rate" className="w-32">
                <SelectValue>{form.defaultVatRate} %</SelectValue>
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
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="kleinunternehmer"
              checked={form.kleinunternehmer}
              onCheckedChange={(checked) =>
                setForm({ ...form, kleinunternehmer: checked === true })
              }
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="kleinunternehmer">{t("kleinunternehmer")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("kleinunternehmerHint")}
              </p>
            </div>
          </div>
          <Button type="submit" disabled={pending} className="self-start">
            {tCommon("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
