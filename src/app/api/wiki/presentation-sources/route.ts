import { z } from "zod";
import { getSession } from "@/lib/auth";
import { presentationSourcePreviews, documentPresentationLinks, getPresentationSourceDocument, listPresentationSourceDocuments } from "@/modules/wiki/presentation-source-queries";

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

const previewRequest = z.object({ sources: z.array(z.object({ pageId: z.string().min(1).max(64), sectionId: z.string().max(200) })).max(500) });

/** Read-only batch: use the local canvas references, including unsaved relinks. */
export async function POST(request: Request) {
  if (!await getSession()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = previewRequest.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid sources" }, { status: 400 });
  return Response.json({ previews: presentationSourcePreviews(input.data.sources) }, { headers: { "Cache-Control": "private, no-store" } });
}
