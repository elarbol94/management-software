"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LockKeyhole } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { updateMyMarkColor } from "@/modules/settings/actions";
import {
  USER_MARK_COLORS,
  getUserMarkColor,
  initialsForName,
  userMarkColorStyle,
  type UserMarkColor,
} from "@/lib/user-mark-colors";
import { cn } from "@/lib/utils";

type Availability = {
  key: UserMarkColor;
  available: boolean;
  mine: boolean;
  ownerName: string | null;
};

export function MarkColorForm({
  name,
  currentColor,
  availability,
}: {
  name: string;
  currentColor: string;
  availability: Availability[];
}) {
  const t = useTranslations("settings.profile");
  const router = useRouter();
  const [selected, setSelected] = useState<UserMarkColor>(getUserMarkColor(currentColor).key);
  const [pending, startTransition] = useTransition();
  const availabilityByKey = new Map(availability.map((item) => [item.key, item]));

  function choose(color: UserMarkColor) {
    const item = availabilityByKey.get(color);
    if (!item?.available || pending || color === selected) return;
    startTransition(async () => {
      const result = await updateMyMarkColor(color);
      if (!result.ok) {
        toast.error(t("conflict"));
        router.refresh();
        return;
      }
      setSelected(color);
      toast.success(t("saved"));
      router.refresh();
    });
  }

  return <section className="space-y-6">
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
    </div>
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full border-2 bg-background text-sm font-semibold"
          style={{ ...userMarkColorStyle(selected), borderColor: "var(--user-mark-solid)", color: "var(--user-mark-solid)" }}
        >
          {initialsForName(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{t("previewLabel")}</p>
        </div>
        <mark
          className="ml-auto rounded px-2 py-1 text-sm text-foreground"
          style={{ ...userMarkColorStyle(selected), backgroundColor: "var(--user-mark-highlight)", boxShadow: "inset 0 -2px var(--user-mark-solid)" }}
        >
          {t("sampleText")}
        </mark>
      </div>
    </div>
    <fieldset disabled={pending}>
      <legend className="mb-3 text-sm font-medium">{t("chooseColor")}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {USER_MARK_COLORS.map((color) => {
          const item = availabilityByKey.get(color.key);
          const disabled = !item?.available;
          const active = selected === color.key;
          return <button
            key={color.key}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            aria-label={disabled ? t("unavailableColor", { color: t(`colors.${color.key}`) }) : t(`colors.${color.key}`)}
            title={disabled ? t("unavailable") : t(`colors.${color.key}`)}
            onClick={() => choose(color.key)}
            className={cn(
              "group relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-3 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-transparent ring-2",
              disabled && "cursor-not-allowed opacity-45 grayscale-[.25]",
            )}
            style={{
              ...userMarkColorStyle(color.key),
              borderColor: active ? "var(--user-mark-solid)" : undefined,
              boxShadow: active ? "0 0 0 1px var(--user-mark-solid)" : undefined,
            }}
          >
            <span className="size-7 rounded-full border-2 bg-background shadow-sm" style={{ borderColor: "var(--user-mark-solid)", backgroundColor: "var(--user-mark-highlight)" }} />
            <span>{t(`colors.${color.key}`)}</span>
            {active && <Check className="absolute right-2 top-2 size-3.5" style={{ color: "var(--user-mark-solid)" }} />}
            {disabled && <LockKeyhole className="absolute right-2 top-2 size-3 text-muted-foreground" />}
          </button>;
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("availabilityHint")}</p>
    </fieldset>
  </section>;
}
