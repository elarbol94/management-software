"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPresentation, deletePresentation } from "../presentation-actions";

export function NewPresentationForm() {
  const t = useTranslations("wiki");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const name = title.trim() || t("presentations.untitled");
        setBusy(true);
        try {
          const { id } = await createPresentation({ title: name });
          router.push(`/wiki/presentations/${id}`);
        } catch {
          toast.error(t("presentations.createFailed"));
          setBusy(false);
        }
      }}
    >
      <Input
        value={title}
        maxLength={200}
        placeholder={t("presentations.newPlaceholder")}
        aria-label={t("presentations.presentationTitle")}
        className="h-8 w-56"
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        {t("presentations.new")}
      </Button>
    </form>
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
