"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DEFAULT_WIKI_SHORTCUT_BINDINGS,
  isReservedWikiShortcut,
  normalizeWikiShortcut,
  WIKI_SHORTCUT_GROUPS,
  wikiShortcutConflicts,
  type WikiShortcutAction,
  type WikiShortcutBindings,
} from "../lib/wiki-shortcuts";
import { displayShortcut } from "../lib/shortcut-display";

type WikiShortcutsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bindings: WikiShortcutBindings;
  onBindingsChange: (bindings: WikiShortcutBindings) => void;
};

export function WikiShortcutsDialog({ open, onOpenChange, bindings, onBindingsChange }: WikiShortcutsDialogProps) {
  const t = useTranslations("wiki.shortcuts");
  const [recording, setRecording] = useState<WikiShortcutAction | null>(null);
  const [error, setError] = useState("");
  const shortcutKeys = { ctrl: t("keys.ctrl"), delete: t("keys.delete") };
  const label = (action: WikiShortcutAction) => t(`actions.${action}`);

  function capture(action: WikiShortcutAction, event: KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = normalizeWikiShortcut(event);
    if (!shortcut) { setError(t("requiresModifier")); return; }
    if (isReservedWikiShortcut(shortcut)) { setError(t("reserved")); return; }
    const conflict = wikiShortcutConflicts(bindings, action, shortcut);
    if (conflict) { setError(t("conflict", { action: label(conflict) })); return; }
    onBindingsChange({ ...bindings, [action]: shortcut });
    setRecording(null);
    setError("");
  }

  function close(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) { setRecording(null); setError(""); }
  }

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent data-testid="wiki-shortcuts-dialog" className="max-h-[min(82dvh,48rem)] max-w-2xl overflow-y-auto p-0">
      <DialogHeader className="sticky top-0 z-10 border-b bg-popover px-5 py-4 pr-12">
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 px-5 py-4">
        {error && <p role="alert" className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        {WIKI_SHORTCUT_GROUPS.map((group) => <section key={group.label} className="overflow-hidden rounded-lg border">
          <h3 className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t(`groups.${group.label}`)}</h3>
          <div className="divide-y">
            {group.actions.map((action) => <div key={action} className="flex items-center justify-between gap-3 p-2.5">
              <span className="min-w-0 text-sm">{label(action)}</span>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" variant={recording === action ? "secondary" : "outline"} size="sm" className="min-w-24 font-mono text-xs" data-shortcut-recorder onClick={() => { setRecording(action); setError(""); }} onKeyDown={(event) => { if (recording === action) capture(action, event); }}>
                  {recording === action ? t("recording") : displayShortcut(bindings[action], shortcutKeys)}
                </Button>
                <Button type="button" variant="ghost" size="xs" disabled={bindings[action] === DEFAULT_WIKI_SHORTCUT_BINDINGS[action]} aria-label={t("resetOne", { action: label(action) })} onClick={() => { onBindingsChange({ ...bindings, [action]: DEFAULT_WIKI_SHORTCUT_BINDINGS[action] }); setRecording(null); setError(""); }}>
                  <RotateCcw className="size-3.5" />
                </Button>
              </div>
            </div>)}
          </div>
        </section>)}
      </div>
      <DialogFooter className="sticky bottom-0 m-0 border-t bg-popover px-5 py-3 sm:justify-between">
        <Button type="button" variant="outline" onClick={() => { onBindingsChange({ ...DEFAULT_WIKI_SHORTCUT_BINDINGS }); setRecording(null); setError(""); }}>{t("resetAll")}</Button>
        <Button type="button" onClick={() => close(false)}>{t("done")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
