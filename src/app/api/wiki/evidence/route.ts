import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isEvidenceTargetType } from "@/modules/wiki/lib/pdf-evidence";
import { getEvidenceAnnotation, listEvidenceForTarget, searchEvidenceAnnotations } from "@/modules/wiki/pdf-queries";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  // Single-annotation lookup for the reader's "insert into page" hand-off.
  const annotationId = url.searchParams.get("annotationId");
  if (annotationId) {
    const annotation = getEvidenceAnnotation(annotationId);
    if (!annotation) return NextResponse.json({ error: "Annotation not found" }, { status: 404 });
    return NextResponse.json({ annotation });
  }
  const targetType = url.searchParams.get("targetType") ?? ""; const targetId = url.searchParams.get("targetId") ?? "";
  if (!isEvidenceTargetType(targetType) || !targetId) return NextResponse.json({ error: "Invalid evidence target" }, { status: 400 });
  return NextResponse.json({ linked: listEvidenceForTarget(targetType, targetId), available: searchEvidenceAnnotations(url.searchParams.get("q") ?? "", 100) });
}
