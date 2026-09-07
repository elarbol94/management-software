"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Dialog as PanelDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function subscribe(callback: () => void) {
  const query = window.matchMedia("(min-width: 1280px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/** Keep one mounted tool tree when docking, dismissing, or resizing the workspace. */
export function WorkspacePanel({ title, open, onClose, children, side = "right", narrow = false, className }: {
  title: string; open: boolean; onClose: () => void; children: ReactNode;
  side?: "left" | "right"; narrow?: boolean; className?: string;
}) {
  const t = useTranslations("wiki.workspace");
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia("(min-width: 1280px)").matches, () => false);
  const slot = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [container] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  useLayoutEffect(() => {
    if (!container) return;
    const active = container.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    (desktop ? slot.current : document.body)?.appendChild(container);
    active?.focus({ preventScroll: true });
    return () => { container.remove(); };
  }, [container, desktop]);
  const close = () => {
    // Draft property inputs commit before the tool surface becomes hidden.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onClose();
  };
  return <>
    <div ref={slot} hidden={!desktop || !open} className={cn("min-w-0 shrink-0 self-start overflow-x-hidden border-border/70 bg-background", narrow ? "w-[220px]" : "w-80", side === "right" ? "border-l" : "border-r", className)} />
    <PanelDialog.Root open={open} modal={!desktop} disablePointerDismissal={desktop} onOpenChange={(value) => {
      if (!value) close();
    }}>
      <PanelDialog.Portal keepMounted container={container}>
        {!desktop && <PanelDialog.Backdrop className="fixed inset-0 z-50 bg-black/20 data-closed:hidden" />}
        <PanelDialog.Popup ref={popup} role={desktop ? "complementary" : "dialog"} initialFocus={desktop ? false : () => {
          const active = document.activeElement;
          if (active instanceof HTMLElement && popup.current?.contains(active)) return active;
          return Array.from(popup.current?.querySelectorAll<HTMLElement>("[data-workspace-autofocus]") ?? []).find((field) => field.getClientRects().length > 0) ?? popup.current;
        }} finalFocus={desktop ? false : undefined} aria-describedby={undefined} data-workspace-panel className={cn("min-w-0 bg-background outline-none data-closed:hidden", desktop ? "relative w-full" : "fixed inset-y-0 z-50 w-[min(320px,calc(100vw-24px))] overflow-y-auto border-border shadow-xl", !desktop && (side === "right" ? "right-0 border-l" : "left-0 border-r"))}>
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
            <PanelDialog.Title className="text-sm font-medium">{title}</PanelDialog.Title>
            <Button size="icon-sm" variant="ghost" aria-label={t("closePanel")} onClick={close}><X className="size-4" /></Button>
          </div>
          <div className="workspace-panel-body min-w-0 p-4">{children}</div>
        </PanelDialog.Popup>
      </PanelDialog.Portal>
    </PanelDialog.Root>
  </>;
}
