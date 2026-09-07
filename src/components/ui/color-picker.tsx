"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "./popover";

// Office-style columns: base color followed by five coordinated tints/shades.
const THEME_COLORS = [
  ["#ffffff", "#f2f2f2", "#d9d9d9", "#bfbfbf", "#a6a6a6", "#808080"],
  ["#000000", "#808080", "#595959", "#404040", "#262626", "#0d0d0d"],
  ["#e7e6e6", "#d0cece", "#aeaaaa", "#757171", "#3b3838", "#181717"],
  ["#44546a", "#d6dce4", "#adb9ca", "#8497b0", "#333f50", "#222a35"],
  ["#4472c4", "#d9e2f3", "#b4c6e7", "#8eaadb", "#2f5496", "#203864"],
  ["#ed7d31", "#fbe4d5", "#f8cbad", "#f4b183", "#c55a11", "#833c0b"],
  ["#a5a5a5", "#ededed", "#dbdbdb", "#c9c9c9", "#7b7b7b", "#525252"],
  ["#ffc000", "#fff2cc", "#ffe699", "#ffd966", "#bf9000", "#7f6000"],
  ["#5b9bd5", "#deebf7", "#bdd7ee", "#9dc3e6", "#2e75b6", "#1f4e78"],
  ["#70ad47", "#e2efd9", "#c5e0b3", "#a8d08d", "#538135", "#375623"],
];
const STANDARD_COLORS = ["#c00000", "#ff0000", "#ffc000", "#ffff00", "#92d050", "#00b050", "#00b0f0", "#0070c0", "#002060", "#7030a0"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

type ColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  "aria-label": string;
  id?: string;
  disabled?: boolean;
  className?: string;
  /** Empty string retains the caller's existing automatic/transparent meaning. */
  clearLabel?: string;
};

export function ColorPicker({ value, onChange, "aria-label": label, id, disabled, className, clearLabel }: ColorPickerProps) {
  const t = useTranslations("colorPicker");
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value || "#ffffff");
  const choose = (color: string) => {
    if (disabled) return;
    onChange(color);
    setOpen(false);
  };
  const swatch = (color: string, key: string) => (
    <button
      key={key}
      type="button"
      aria-label={t("selectColor", { color: color.toUpperCase() })}
      title={color.toUpperCase()}
      aria-pressed={value.toLowerCase() === color}
      onClick={() => choose(color)}
      className="relative h-6 w-full border border-black/15 outline-none hover:z-10 hover:ring-2 hover:ring-ring focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring"
      style={{ backgroundColor: color }}
    >
      {value.toLowerCase() === color && <Check className="absolute inset-0 m-auto size-4 rounded-sm bg-white text-black" />}
    </button>
  );
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 10, ArrowUp: -10 }[event.key];
    if (offset === undefined) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[(index + offset + buttons.length) % buttons.length]?.focus();
  };

  return <Popover open={open && !disabled} onOpenChange={(next) => {
    setOpen(next);
    if (next) setCustom(HEX_COLOR.test(value) ? value : "#ffffff");
  }}>
    <PopoverTrigger
      id={id}
      type="button"
      disabled={disabled}
      aria-label={label}
      title={`${label}: ${value || clearLabel || t("automatic")}`}
      className={cn("inline-flex h-9 w-16 shrink-0 items-center gap-1 rounded-md border bg-background p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)}
    >
      <span className="h-full min-w-4 flex-1 rounded-sm border border-black/15" style={{ background: value || "linear-gradient(135deg, #ffffff 46%, #ef4444 47%, #ef4444 53%, #ffffff 54%)" }} />
      <ChevronDown className="size-3 shrink-0" />
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1rem)]" aria-label={label}>
      <PopoverTitle>{label}</PopoverTitle>
      {clearLabel && <Button type="button" variant="ghost" className="justify-start" onClick={() => choose("")}>{clearLabel}</Button>}
      <p className="text-xs font-medium text-muted-foreground">{t("themeColors")}</p>
      <div role="group" aria-label={t("themeColors")} className="grid grid-cols-10 gap-x-1 gap-y-0.5" onKeyDown={navigate}>
        {Array.from({ length: 6 }, (_, row) => THEME_COLORS.map((column, col) => <div className={row === 0 ? "mb-1" : ""} key={`${row}-${col}`}>{swatch(column[row], `${row}-${col}`)}</div>))}
      </div>
      <p className="text-xs font-medium text-muted-foreground">{t("standardColors")}</p>
      <div role="group" aria-label={t("standardColors")} className="grid grid-cols-10 gap-1" onKeyDown={navigate}>
        {STANDARD_COLORS.map((color) => swatch(color, color))}
      </div>
      <div className="flex items-center gap-2 border-t pt-2">
        <input type="color" aria-label={t("customColor")} value={HEX_COLOR.test(custom) ? custom : "#ffffff"} onChange={(event) => setCustom(event.target.value)} className="h-8 w-9 shrink-0 cursor-pointer rounded border p-0.5" />
        <Input aria-label={t("hexColor")} value={custom} maxLength={7} spellCheck={false} className="h-8 min-w-0 font-mono text-xs" onChange={(event) => setCustom(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (HEX_COLOR.test(custom)) choose(custom.toLowerCase());
          }
        }} />
        <Button type="button" variant="outline" size="sm" disabled={!HEX_COLOR.test(custom)} onClick={() => choose(custom.toLowerCase())}>{t("apply")}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
