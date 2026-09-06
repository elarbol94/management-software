import { eq } from "drizzle-orm";
import { db } from "@/db";
import { wikiFigureAssets } from "@/db/schema";
import { requireUserOrThrow } from "@/lib/auth";
import { figureRevisionBytes, requireFigurePage } from "@/modules/wiki/figure-assets";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUserOrThrow();
    const { id } = await params;
    const asset = db.select().from(wikiFigureAssets).where(eq(wikiFigureAssets.id, id)).get();
    if (!asset) return new Response(null, { status: 404 });
    requireFigurePage(asset.pageId);
    const raw = new URL(request.url).searchParams.get("v");
    const version = raw ? Number(raw) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) return new Response(null, { status: 400 });
    const content = await figureRevisionBytes(asset.pageId, id, version);
    return new Response(new Uint8Array(content.bytes), { headers: {
      "Content-Type": content.mimeType, "Cache-Control": raw ? "private, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    } });
  } catch (error) { return new Response(null, { status: error instanceof Error && error.message === "Unauthorized" ? 401 : 404 }); }
}
