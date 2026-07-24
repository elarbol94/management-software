import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Landmark } from "@/components/server-safe-icons";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";

export const unstable_instant = {
  prefetch: "runtime",
  samples: [
    {
      cookies: [{ name: "locale", value: "de" }],
      headers: [["rsc", "1"], ["next-action", null]],
      params: { id: "sample", projectId: "sample" },
    },
  ],
};

async function AccountingHeader() {
  const t = await getTranslations("accountingShell");
  return (
    <header className="border-b border-[#dfe5e1] bg-white">
        <div className="mx-auto max-w-[1480px] px-4 pt-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 pb-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#e7efeb] text-[#315c73] ring-1 ring-[#d5e1dc]">
              <Landmark className="size-4.5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-[#73807c] uppercase">
                {t("eyebrow")}
              </p>
              <p className="text-lg font-semibold tracking-[-0.025em] text-[#17342d]">
                {t("title")}
              </p>
            </div>
          </div>
          <AccountingNav />
        </div>
    </header>
  );
}

export default function AccountingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="-m-6 min-h-screen bg-[#f3f5f2] text-[#17342d]">
      <Suspense fallback={<div className="h-[105px] border-b bg-white" />}>
        <AccountingHeader />
      </Suspense>
      <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </div>
    </div>
  );
}
