import { getSession } from "@/lib/auth";
import { generateWikiDocumentPdf, renderStoredWikiDocument } from "@/modules/wiki/lib/document-pdf";
import { parseDocumentSettings } from "@/modules/wiki/lib/document-settings";
import { renderDocumentMarkdown } from "@/modules/wiki/lib/document-renderer";

import { parseDocumentForExport } from "@/modules/wiki/lib/suggestions";
import { generateDocumentDocx } from "@/modules/wiki/lib/document-docx";
import { getWikiTypographyForUser } from "@/modules/wiki/lib/wiki-typography.server";

function disposition(slug: string, extension: string, inline: boolean) {
  const safe = slug.replace(/[^a-z0-9_-]+/gi, "-") || "document";
  return `${inline ? "inline" : "attachment"}; filename="${safe}.${extension}"`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const pageOwner = db.select({ createdBy: wikiPages.createdBy })
    .from(wikiPages)
    .where(and(eq(wikiPages.id, id), isNull(wikiPages.deletedAt)))
    .get();
  if (!pageOwner) return Response.json({ error: "Page not found" }, { status: 404 });
  const typography = getWikiTypographyForUser(pageOwner.createdBy);
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "markdown";
  const inline = url.searchParams.get("disposition") === "inline";
  try {
    if (format === "pdf") {
      const { pdf, page, rendered } = await generateWikiDocumentPdf(id, typography);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": disposition(page.slug, "pdf", inline),
          "Cache-Control": "no-store",
          "X-Document-Issues": String(rendered.issues.length),
        },
      });
    }

    const { page, rendered } = await renderStoredWikiDocument(id, typography);
    if (format === "docx") {
      const bytes = await generateDocumentDocx(page.title, parseDocumentForExport(page.contentJson), parseDocumentSettings(page.documentSettingsJson));
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": disposition(page.slug, "docx", inline), "Cache-Control": "no-store" } });
    }
    if (format === "html") {
      return new Response(rendered.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": disposition(page.slug, "html", inline),
        },
      });
    }
    const markdown = `# ${page.title}\n\n${renderDocumentMarkdown(
      parseDocumentForExport(page.contentJson),
      parseDocumentSettings(page.documentSettingsJson),
      url.origin,
    )}`;
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": disposition(page.slug, "md", inline),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document export failed";
    const status = message === "Page not found" ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { wikiPages } from "@/db/schema";
