import { getTranslations } from "next-intl/server";
import { RadioTower } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { PresentationJoinForm } from "@/modules/wiki/components/presentation-live";

export default async function FollowPresentationPage() {
  const [, t] = await Promise.all([requireUser(), getTranslations("wiki")]);
  return (
    <div className="p-5 md:p-8">
      <div className="mx-auto max-w-md rounded-xl border bg-card p-6 text-center">
        <RadioTower className="mx-auto mb-3 size-8 text-indigo-400" />
        <h1 className="text-xl font-semibold tracking-tight">{t("presentations.joinLive")}</h1>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">{t("presentations.joinLiveDescription")}</p>
        <div className="flex justify-center">
          <PresentationJoinForm />
        </div>
      </div>
    </div>
  );
}
