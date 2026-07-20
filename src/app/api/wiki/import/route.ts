import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseBibTeX, parseRis } from "@/modules/wiki/lib/interchange";
export async function POST(request: Request) { if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const data = await request.formData(); const file = data.get("file"); if (!(file instanceof File) || file.size > 2_000_000) return NextResponse.json({ error: "Invalid or oversized import" }, { status: 400 }); const text = await file.text(); const lower = file.name.toLowerCase(); const records = lower.endsWith(".ris") ? parseRis(text) : parseBibTeX(text); return NextResponse.json({ records, count: records.length }); }
