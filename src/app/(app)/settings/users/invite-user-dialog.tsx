"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { invitePlatformUser } from "@/modules/settings/user-actions";
import type { InviteUserInput } from "@/modules/settings/user-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function InviteUserDialog() {
  const t = useTranslations("settings.users");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<InviteUserInput>({
    email: "",
    role: "member",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const result = await invitePlatformUser(form);
      if (result.error) {
        setError(t(result.error));
        return;
      }

      toast.success(t("invitationSent"));
      setOpen(false);
      setForm({
        email: "",
        role: "member",
      });
      router.refresh();
    } catch {
      setError(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (pending) return;
      setOpen(nextOpen);
      setError(null);
      if (!nextOpen) setForm({ email: "", role: "member" });
    }}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        {t("inviteUser")}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("inviteUser")}</DialogTitle>
          <DialogDescription>{t("inviteHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-user-email">{t("email")}</Label>
              <Input
                id="new-user-email"
                type="email"
                maxLength={254}
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-user-role">{t("role")}</Label>
              <Select
                disabled={pending}
                value={form.role}
                onValueChange={(value) =>
                  setForm({ ...form, role: value as "member" | "personnel" | "admin" })
                }
              >
                <SelectTrigger id="new-user-role">
                  <SelectValue>
                    {form.role === "admin"
                      ? t("roleAdmin")
                      : form.role === "personnel"
                        ? t("rolePersonnel")
                        : t("roleMember")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t("roleMember")}</SelectItem>
                  <SelectItem value="personnel">{t("rolePersonnel")}</SelectItem>
                  <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? t("sendingInvitation") : t("sendInvitation")}
            </Button>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
