import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth";
import { liveSessionCodeSchema } from "@/modules/wiki/lib/live-session";
import { getLiveSessionByCode, getPresentation } from "@/modules/wiki/presentation-queries";
import { PresentationJoinForm } from "@/modules/wiki/components/presentation-live";
import { PresentationPlayer } from "@/modules/wiki/components/presentation-player";

/**
 * Read-only follow view. `requireUser` first: a join code is a convenience for people who
 * already have an account here, never a way past sign-in.
 */
export default async function FollowLiveSessionPage({ params }: { params: Promise<{ code: string }> }) {
  const [, { code }] = await Promise.all([requireUser(), params]);
  const parsed = liveSessionCodeSchema.safeParse(code);
  const session = parsed.success ? getLiveSessionByCode(parsed.data) : null;

  if (!session) {
    const t = await getTranslations("wiki");
    return (
      <div className="p-5 md:p-8">
        <div className="mx-auto max-w-md rounded-xl border bg-card p-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{t("presentations.followNotFound")}</h1>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">{t("presentations.followNotFoundDescription")}</p>
          <div className="flex justify-center">
            <PresentationJoinForm />
          </div>
        </div>
      </div>
    );
  }

  const presentation = getPresentation(session.presentationId);
  if (!presentation) notFound();
  return <PresentationPlayer presentation={presentation} follow={{ code: session.code, hostName: session.hostName }} />;
}
