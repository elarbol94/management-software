import { getSession } from "@/lib/auth";
import { documentPresentationLinks, getPresentationSourceDocument, listPresentationSourceDocuments } from "@/modules/wiki/presentation-source-queries";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const sourceId = query.get("source");
  const pageId = query.get("page");
  if ((sourceId?.length ?? 0) > 64 || (pageId?.length ?? 0) > 64) return Response.json({ error: "Invalid page" }, { status: 400 });
  const headers = { "Cache-Control": "private, no-store" };
  if (sourceId) return Response.json({ document: getPresentationSourceDocument(sourceId) }, { headers });
  if (pageId) return Response.json({ links: documentPresentationLinks(pageId, session.user) }, { headers });
  return Response.json({ documents: listPresentationSourceDocuments() }, { headers });
}
