"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type MobileBottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
  className,
  contentClassName,
}: MobileBottomSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={cn(
          "max-h-[min(86dvh,46rem)] gap-0 overflow-hidden rounded-t-2xl border-x shadow-2xl lg:hidden",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
        <SheetHeader className="relative border-b px-4 pt-3 pb-3 pr-14 text-left">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
          <SheetClose
            aria-label={closeLabel}
            render={<Button variant="ghost" size="icon" className="absolute top-1 right-2 size-11" />}
          >
            <X className="size-5" />
          </SheetClose>
        </SheetHeader>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-4", contentClassName)}>
          {children}
        </div>
        {footer ? (
          <div className="shrink-0 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
