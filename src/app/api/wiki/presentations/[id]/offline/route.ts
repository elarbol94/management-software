import { getSession } from "@/lib/auth";
import { getTranslations, getLocale } from "next-intl/server";
import { getPresentation } from "@/modules/wiki/presentation-queries";
import { offlinePresentationMedia, renderPresentationHtml } from "@/modules/wiki/presentation-delivery";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const presentation = getPresentation((await params).id, session.user);
  if (!presentation) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const [media, t, locale] = await Promise.all([offlinePresentationMedia(presentation), getTranslations("presentationStudio"), getLocale()]);
    const html = renderPresentationHtml(presentation, (id) => media[id], { previous: t("previous"), next: t("next"), overview: t("overview"), play: t("play"), pause: t("pause"), fullscreen: t("fullscreen"), noSteps: t("noSteps") }, locale);
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "attachment; filename=presentation.html", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ error: "Export unavailable: check media files and the 100 MB total media limit" }, { status: 422 }); }
}
