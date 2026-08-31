import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updatePageProofingLanguage } from "@/modules/wiki/actions";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let input: { language?: unknown };
  try { input = await request.json() as { language?: unknown }; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { id } = await params;
  try {
    return NextResponse.json(await updatePageProofingLanguage({ pageId: id, language: input.language as "de-DE" | "de-AT" | "en-US" }));
  } catch {
    return NextResponse.json({ error: "Invalid proofing language" }, { status: 400 });
  }
}
