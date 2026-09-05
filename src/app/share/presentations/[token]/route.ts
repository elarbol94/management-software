import { getLocale, getTranslations } from "next-intl/server";
import { publicPresentation, renderPresentationHtml } from "@/modules/wiki/presentation-delivery";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const presentation = publicPresentation(token);
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  if (!presentation) return new Response("Not found", { status: 404, headers });
  const [t, locale] = await Promise.all([getTranslations("presentationStudio"), getLocale()]);
  return new Response(renderPresentationHtml(presentation, (id) => `/share/presentations/${token}/media/${encodeURIComponent(id)}`, { previous: t("previous"), next: t("next"), overview: t("overview"), play: t("play"), pause: t("pause"), fullscreen: t("fullscreen"), noSteps: t("noSteps") }, locale), {
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; frame-ancestors *; base-uri 'none'; form-action 'none'" },
  });
}
