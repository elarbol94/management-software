"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createPresentation, createPresentationFromWikiPage, deletePresentation } from "../presentation-actions";
import { presentationTemplateIds, type PresentationTemplateId } from "../lib/presentation-templates";

/**
 * Small hand-drawn schematics, not a live render of the template's actual canvas — a
 * template picker only needs to evoke the layout, not reproduce it pixel-for-pixel.
 */

function BlankIcon() {
  return (
    <svg viewBox="0 0 120 76" className="h-16 w-full">
      <rect x="6" y="6" width="108" height="64" rx="8" className="fill-none stroke-current text-muted-foreground/50" strokeWidth="2" strokeDasharray="6 5" />
      <path d="M60 30v16M52 38h16" className="stroke-current text-muted-foreground" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg viewBox="0 0 120 76" className="h-16 w-full">
      <line x1="10" y1="58" x2="110" y2="58" className="stroke-current text-indigo-500" strokeWidth="3" />
      {[16, 42, 68, 94].map((x) => (
        <rect key={x} x={x} y="18" width="18" height="34" rx="3" className="fill-none stroke-current text-foreground/70" strokeWidth="2.5" />
      ))}
      {[16, 42, 68, 94].map((x) => (
        <circle key={x} cx={x + 9} cy="58" r="3" className="fill-current text-indigo-500" />
      ))}
    </svg>
  );
}

function HubIcon() {
  const satellites: [number, number][] = [[60, 10], [94, 38], [60, 66], [26, 38]];
  return (
    <svg viewBox="0 0 120 76" className="h-16 w-full">
      {satellites.map(([cx, cy]) => (
        <line key={`${cx}-${cy}`} x1="60" y1="38" x2={cx} y2={cy} className="stroke-current text-foreground/40" strokeWidth="2" />
      ))}
      <circle cx="60" cy="38" r="10" className="fill-none stroke-current text-indigo-500" strokeWidth="3" />
      {satellites.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="6" className="fill-none stroke-current text-foreground/70" strokeWidth="2.5" />
      ))}
    </svg>
  );
}

function PitchIcon() {
  return (
    <svg viewBox="0 0 120 76" className="h-16 w-full">
      <rect x="30" y="6" width="60" height="10" rx="2" className="fill-current text-foreground/70" />
      <rect x="12" y="24" width="96" height="12" rx="3" className="fill-none stroke-current text-foreground/60" strokeWidth="2.5" />
      <rect x="12" y="42" width="96" height="12" rx="3" className="fill-none stroke-current text-sky-500" strokeWidth="2.5" />
      <rect x="12" y="60" width="96" height="12" rx="3" className="fill-none stroke-current text-teal-500" strokeWidth="2.5" />
    </svg>
  );
}

function MindmapIcon() {
  const branches: [number, number][] = [[90, 14], [98, 40], [34, 64], [12, 44], [26, 10]];
  return (
    <svg viewBox="0 0 120 76" className="h-16 w-full">
      {branches.map(([cx, cy]) => (
        <line key={`${cx}-${cy}`} x1="58" y1="38" x2={cx} y2={cy} className="stroke-current text-foreground/40" strokeWidth="2" />
      ))}
      <line x1="98" y1="40" x2="116" y2="34" className="stroke-current text-foreground/30" strokeWidth="1.5" />
      <circle cx="58" cy="38" r="8" className="fill-current text-rose-500" />
      {branches.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" className="fill-none stroke-current text-foreground/70" strokeWidth="2" />
      ))}
      <circle cx="116" cy="34" r="3" className="fill-none stroke-current text-foreground/50" strokeWidth="1.5" />
    </svg>
  );
}

const TEMPLATE_ICONS: Record<PresentationTemplateId, () => React.ReactElement> = {
  timeline: TimelineIcon,
  hub: HubIcon,
  pitch: PitchIcon,
  mindmap: MindmapIcon,
};

function TemplateCard({
  name,
  disabled,
  onClick,
  children,
}: {
  name: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border bg-card p-3 text-center transition-colors hover:border-indigo-400 disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {children}
      <span className="text-xs font-medium">{name}</span>
    </button>
  );
}

export function NewPresentationForm() {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async (templateId?: PresentationTemplateId) => {
    const name = title.trim() || t("presentations.untitled");
    setBusy(true);
    try {
      const { id } = await createPresentation({ title: name, templateId });
      setOpen(false);
      setTitle("");
      setBusy(false);
      router.push(`/wiki/presentations/${id}`);
    } catch {
      toast.error(t("presentations.createFailed"));
      setBusy(false);
    }
  };

  return (
    <>
      <form
        className="flex w-full flex-wrap items-center gap-2 sm:w-auto"
        onSubmit={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Input
          value={title}
          maxLength={200}
          placeholder={t("presentations.newPlaceholder")}
          aria-label={t("presentations.presentationTitle")}
          className="h-8 min-w-0 flex-1 sm:w-56"
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {t("presentations.new")}
        </Button>
      </form>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("presentations.chooseTemplate")}</DialogTitle>
            <DialogDescription>{t("presentations.chooseTemplateDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <TemplateCard name={t("presentations.templates.blank")} disabled={busy} onClick={() => void create()}>
              <BlankIcon />
            </TemplateCard>
            {presentationTemplateIds.map((id) => {
              const Icon = TEMPLATE_ICONS[id];
              return (
                <TemplateCard
                  key={id}
                  name={t(`presentations.templates.${id}`)}
                  disabled={busy}
                  onClick={() => void create(id)}
                >
                  <Icon />
                </TemplateCard>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NewPresentationFromWikiPage({ pages }: { pages: Array<{ id: string; title: string }> }) {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pageId, setPageId] = useState<string>(pages[0]?.id ?? "");
  const [includeImages, setIncludeImages] = useState(true);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!pageId) return;
    setBusy(true);
    try {
      const { id } = await createPresentationFromWikiPage({ pageId, includeImages });
      setOpen(false);
      setBusy(false);
      router.push(`/wiki/presentations/${id}`);
    } catch {
      toast.error(t("presentations.createFailed"));
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={!pages.length} onClick={() => setOpen(true)}>
        <FileText className="size-3.5" />
        {t("presentations.fromWikiPage")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("presentations.fromWikiPage")}</DialogTitle>
            <DialogDescription>{t("presentations.fromWikiPageDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="from-wiki-page-select">{t("presentations.wikiPage")}</Label>
              <Select value={pageId} onValueChange={(value) => setPageId(value ?? "")}>
                <SelectTrigger id="from-wiki-page-select" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pages.map((page) => (
                    <SelectItem key={page.id} value={page.id}>
                      {page.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeImages} onCheckedChange={(checked) => setIncludeImages(checked === true)} />
              {t("presentations.includeImages")}
            </label>
            <Button type="button" className="w-full" disabled={busy || !pageId} onClick={() => void create()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {t("presentations.new")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeletePresentationButton({ id, title }: { id: string; title: string }) {
  const t = useTranslations("wiki");
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("presentations.deletePresentation")}
      onClick={async () => {
        if (!confirm(t("presentations.deleteConfirm", { title }))) return;
        try {
          await deletePresentation({ id });
          router.refresh();
        } catch {
          toast.error(t("presentations.deleteFailed"));
        }
      }}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
