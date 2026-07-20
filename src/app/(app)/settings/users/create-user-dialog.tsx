"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
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
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "member" as "member" | "personnel" | "admin",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);

    const { error } = await authClient.admin.createUser({
      name: form.name,
      email: form.email,
      password: form.password,
      // Better Auth's client types only know the built-in "user" | "admin"
      // union; the server is configured with defaultRole "member".
      role: form.role as "admin",
    });

    setPending(false);
    if (error) {
      toast.error(error.message ?? tCommon("error"));
      return;
    }

    toast.success(t("created"));
    setOpen(false);
    setForm({ name: "", email: "", password: "", role: "member" });
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        {t("addUser")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("addUser")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-user-name">{t("name")}</Label>
            <Input
              id="new-user-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-user-email">{t("email")}</Label>
            <Input
              id="new-user-email"
              type="email"
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
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("role")}</Label>
            <Select
              value={form.role}
              onValueChange={(value) =>
                setForm({ ...form, role: value as "member" | "personnel" | "admin" })
              }
            >
              <SelectTrigger>
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
          <Button type="submit" disabled={pending}>
            {tCommon("create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
