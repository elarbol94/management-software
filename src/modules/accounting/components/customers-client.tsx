"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteCustomer,
  upsertCustomer,
  type CustomerInput,
} from "@/modules/accounting/invoice-actions";
import type { customers as customersTable } from "@/modules/accounting/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Customer = typeof customersTable.$inferSelect & { invoiceCount: number };

export function CustomersClient({ customers }: { customers: Customer[] }) {
  const t = useTranslations("invoices");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerInput>({
    name: "",
    address: "",
    uid: "",
    email: "",
    notes: "",
  });
  const [pending, setPending] = useState(false);

  function openDialog(customer: Customer | null) {
    setEditing(customer);
    setForm({
      name: customer?.name ?? "",
      address: customer?.address ?? "",
      uid: customer?.uid ?? "",
      email: customer?.email ?? "",
      notes: customer?.notes ?? "",
    });
    setDialogOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await upsertCustomer({ ...form, id: editing?.id });
      toast.success(tCommon("saved"));
      setDialogOpen(false);
      router.refresh();
    } catch {
      toast.error(tCommon("error"));
    } finally {
      setPending(false);
    }
  }

  async function onDelete(customer: Customer) {
    if (!window.confirm(tCommon("confirmDeleteTitle"))) return;
    const { deleted } = await deleteCustomer(customer.id);
    if (!deleted) toast.info(t("customerInUse"));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" className="self-start" onClick={() => openDialog(null)}>
        <Plus className="size-4" />
        {t("newCustomer")}
      </Button>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("customerName")}</TableHead>
              <TableHead>{t("customerUid")}</TableHead>
              <TableHead>{t("customerEmail")}</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("noCustomers")}
                </TableCell>
              </TableRow>
            )}
            {customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell className="font-medium">{customer.name}</TableCell>
                <TableCell>{customer.uid}</TableCell>
                <TableCell>{customer.email}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => openDialog(customer)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onDelete(customer)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("editCustomer") : t("newCustomer")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="customer-name">{t("customerName")}</Label>
              <Input
                id="customer-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="customer-address">{t("customerAddress")}</Label>
              <Textarea
                id="customer-address"
                rows={3}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-uid">{t("customerUid")}</Label>
                <Input
                  id="customer-uid"
                  value={form.uid}
                  onChange={(e) => setForm({ ...form, uid: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="customer-email">{t("customerEmail")}</Label>
                <Input
                  id="customer-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
            <Button type="submit" disabled={pending}>
              {tCommon("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
