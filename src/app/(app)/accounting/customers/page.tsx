import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "@/components/server-safe-icons";
import { requireUser } from "@/lib/auth";
import { listCustomers } from "@/modules/accounting/invoice-queries";
import { CustomersClient } from "@/modules/accounting/components/customers-client";
import { Button } from "@/components/ui/button";

export default async function CustomersPage() {
  await requireUser();
  const t = await getTranslations("invoices");
  const customers = listCustomers();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/accounting/invoices" />}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("customers")}
        </h1>
      </div>
      <CustomersClient customers={customers} />
    </div>
  );
}
