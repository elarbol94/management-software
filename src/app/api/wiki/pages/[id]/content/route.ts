import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { savePageContent } from "@/modules/wiki/actions";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { id } = await params;
  try {
    return NextResponse.json(await savePageContent({ ...input, id } as Parameters<typeof savePageContent>[0]));
  } catch {
    return NextResponse.json({ error: "Invalid page content" }, { status: 400 });
  }
}
