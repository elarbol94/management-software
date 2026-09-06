"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Check, ChevronDown, Languages, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROOFING_LANGUAGES, type ProofingLanguage, type SpellcheckIssue } from "../lib/spellcheck";
import type { ProofingStatus } from "../lib/spellcheck-controller";

export type OpenProofingIssue = { issue: SpellcheckIssue; target: HTMLElement; source: string };

export function WikiProofingSuggestions({ selected, onClose, onReplace, onReplaceAll, onIgnore, onDictionary, onDisableRule, editable, busy }: {
  selected: OpenProofingIssue;
  onClose: () => void;
  onReplace: (replacement: string) => void;
  onReplaceAll: (replacement: string) => void;
  onIgnore: () => void;
  onDictionary: () => void;
  onDisableRule: () => void;
  editable: boolean;
  busy: boolean;
}) {
  const t = useTranslations("wiki.editor.proofing");
  const { issue, source, target } = selected;
  const firstSuggestion = useRef<HTMLButtonElement>(null);
  const anchor = useMemo(() => {
    const rect = target.getBoundingClientRect();
    return { getBoundingClientRect: () => target.isConnected ? target.getBoundingClientRect() : rect, contextElement: target };
  }, [target]);
  return <PopoverPrimitive.Root open onOpenChange={(open, details) => {
    // The editor underline is the trigger. The click that opens this externally
    // controlled popover must not also be treated as an outside click.
    if (!open && details.reason === "outside-press" && details.event.target instanceof globalThis.Node && target.contains(details.event.target)) {
      details.cancel();
      return;
    }
    if (!open) onClose();
  }}>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner anchor={anchor} align="start" sideOffset={6} collisionPadding={12} className="z-50">
        <PopoverPrimitive.Popup aria-label={t("dialog")} initialFocus={firstSuggestion} finalFocus={() => target.closest<HTMLElement>(".ProseMirror")} className="max-h-[min(28rem,var(--available-height))] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg outline-none">
          <div className="flex items-start justify-between gap-2 px-2 pt-1">
            <div className="min-w-0"><p className="text-xs text-muted-foreground">{t(issue.kind === "spelling" ? "types.spelling" : "types.writing")}</p><p className="break-words font-medium">{source}</p></div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("close")} onClick={onClose}><X /></Button>
          </div>
          <p className="px-2 py-2 text-xs text-muted-foreground">{issue.message}</p>
          {issue.pending && <p role="status" className="px-2 pb-2 text-xs text-muted-foreground">{t("recheckingSuggestion")}</p>}
          <div className="flex flex-wrap gap-1 p-1">
            {issue.replacements.length ? issue.replacements.map((replacement, index) => <Button ref={index === 0 ? firstSuggestion : undefined} key={replacement} type="button" variant={index === 0 ? "secondary" : "outline"} size="sm" disabled={!editable || issue.pending} className="h-auto min-h-8 max-w-full whitespace-normal break-words text-left" onClick={() => onReplace(replacement)}>{index === 0 && <Check className="size-3.5 shrink-0" />}{replacement || t("deleteText")}</Button>) : <p className="px-1 text-xs text-muted-foreground">{t("noReplacement")}</p>}
          </div>
          <div className="mt-1 border-t pt-1">
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={onIgnore}>{t("ignore")}</Button>
            {issue.kind === "spelling" && <Button type="button" variant="ghost" size="sm" disabled={busy} className="h-auto min-h-8 w-full justify-start whitespace-normal text-left" onClick={onDictionary}>{t("addToDictionary")}</Button>}
            <details className="px-2 py-1 text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">{t("moreActions")}</summary>
              {issue.replacements.length > 0 && <Button type="button" variant="ghost" size="sm" disabled={!editable || issue.pending} className="h-auto min-h-8 w-full justify-start whitespace-normal text-left" onClick={() => onReplaceAll(issue.replacements[0])}>{t("replaceAll")}</Button>}
              {issue.ruleId && <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={onDisableRule}>{t("disableRule")}</Button>}
            </details>
          </div>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}

export function WikiProofingMenu({ language, status, count, picky, saving, onLanguage, onPicky, onRetry, onNext, compact = false }: {
  language: ProofingLanguage; status: ProofingStatus; count: number; picky: boolean; saving: boolean;
  onLanguage: (language: ProofingLanguage) => void; onPicky: () => void; onRetry: () => void; onNext: () => void; compact?: boolean;
}) {
  const t = useTranslations("wiki.editor.proofing");
  const [open, setOpen] = useState(false);
  const names: Record<ProofingLanguage, string> = { "de-DE": t("languages.de"), "de-AT": t("languages.deAt"), "en-US": t("languages.en") };
  const label = saving ? t("saving") : status === "error" ? t("fallbackShort") : count ? t("issueCount", { count }) : status === "checking" ? t("checking") : t("ready");
  const icon: ReactElement = status === "checking" ? <RotateCcw className="size-3 animate-spin" /> : <Languages className="size-3.5" />;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" data-testid={compact ? "proofing-menu-compact" : "proofing-language-toggle"} variant="outline" className={compact ? "xl:hidden" : "h-auto w-full flex-col items-stretch gap-1.5 px-2 py-2"} aria-label={t("title")} />}>
      <span className="flex items-center gap-1.5 text-xs font-medium">{icon}{t(compact ? "title" : "shortTitle")}<ChevronDown className="ml-auto size-3" /></span>
      {!compact && <span className="whitespace-normal text-[10px] leading-tight text-muted-foreground" data-testid="proofing-status">{label}</span>}
      {!compact && !saving && status === "checking" && count > 0 && <span className="whitespace-normal text-[10px] leading-tight text-muted-foreground" data-testid="proofing-pending">{t("checkingChanges")}</span>}
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80">
      <p className="text-sm font-medium">{t("title")}</p>
      <label className="space-y-1 text-xs"><span>{t("language")}</span>
        <Select value={language} onValueChange={(value) => { if (value) onLanguage(value as ProofingLanguage); }} disabled={saving}>
          <SelectTrigger aria-label={t("language")} className="w-full"><SelectValue>{names[language]}</SelectValue></SelectTrigger>
          <SelectContent>{PROOFING_LANGUAGES.map((item) => <SelectItem key={item} value={item}>{names[item]}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={picky} disabled={saving} onChange={onPicky} />{t("picky")}</label>
      <p role="status" className="text-xs text-muted-foreground">{!saving && status === "error" ? t("browserFallback") : label}</p>
      {!saving && status === "checking" && count > 0 && <p className="text-xs text-muted-foreground">{t("checkingChanges")}</p>}
      {status === "error" && <Button type="button" size="sm" variant="outline" onClick={onRetry}><RotateCcw />{t("retry")}</Button>}
      <Button type="button" size="sm" variant="secondary" disabled={!count} onClick={() => { setOpen(false); onNext(); }}>{t("nextIssue")}<kbd className="ml-auto text-xs text-muted-foreground">Alt+F7</kbd></Button>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
    </PopoverContent>
  </Popover>;
}
