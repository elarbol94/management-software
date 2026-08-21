import { getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { loadMunicipalityInvestmentData } from "@/modules/municipalities/investment-data.server";
import { municipalityInvestmentHtmlFilename, renderMunicipalityInvestmentHtml } from "@/modules/municipalities/investment-html";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ municipalityCode: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { municipalityCode } = await params;
  const data = await loadMunicipalityInvestmentData(municipalityCode);
  if (!data) return Response.json({ error: "Municipality investment data not found" }, { status: 404 });
  const locale = await getLocale();
  const html = renderMunicipalityInvestmentHtml(data, locale === "en" ? "en" : "de");
  const filename = municipalityInvestmentHtmlFilename(data.municipality.code, data.municipality.name);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
