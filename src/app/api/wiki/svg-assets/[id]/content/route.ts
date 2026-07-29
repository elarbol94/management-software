import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { renderSvgAsset } from "@/modules/wiki/svg-assets";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const asset = renderSvgAsset(id);
    if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(asset.svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "private, no-cache",
        "ETag": `"svg-${id}-${asset.version}"`,
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "SVG could not be rendered" }, { status: 400 });
  }
}
