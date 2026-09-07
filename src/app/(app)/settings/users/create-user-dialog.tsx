"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createPlatformUser } from "@/modules/settings/user-actions";
import type { CreateUserInput } from "@/modules/settings/user-input";
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

export function CreateUserDialog() {
  const t = useTranslations("settings.users");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateUserInput>({
    name: "",
    username: "",
    email: "",
    password: "",
    role: "member",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const result = await createPlatformUser(form);
      if (result.error) {
        setError(t(result.error));
        return;
      }

      toast.success(t("created"));
      setOpen(false);
      setForm({
        name: "",
        username: "",
        email: "",
        password: "",
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
      if (!nextOpen) setForm({ name: "", username: "", email: "", password: "", role: "member" });
    }}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        {t("addUser")}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("addUser")}</DialogTitle>
          <DialogDescription>{t("loginHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-user-name">{t("name")}</Label>
              <Input
                id="new-user-name"
                maxLength={200}
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-user-username">{t("username")}</Label>
              <Input
                id="new-user-username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                minLength={3}
                maxLength={254}
                pattern="[A-Za-z0-9_.@+\-]+"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="new-user-username-hint"
              />
              <p id="new-user-username-hint" className="text-xs text-muted-foreground">{t("usernameHint")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-user-email">{t("email")}</Label>
              <Input
                id="new-user-email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-user-password">{t("password")}</Label>
              <Input
                id="new-user-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                aria-describedby="new-user-password-hint"
              />
              <p id="new-user-password-hint" className="text-xs text-muted-foreground">{t("passwordHint")}</p>
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
              {pending ? t("creating") : tCommon("create")}
            </Button>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
