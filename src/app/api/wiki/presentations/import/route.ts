import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { wikiPresentations } from "@/db/schema";
import { saveAttachment, deleteAttachmentsFor } from "@/lib/files";
import { createId } from "@paralleldrive/cuid2";
import { importPresentationPptx } from "@/modules/wiki/lib/presentation-pptx";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 51 * 1024 * 1024) return Response.json({ error: "File too large" }, { status: 413 });
  const id = createId();
  try {
    const data = await request.formData(), file = data.get("file");
    if (!(file instanceof File) || !/\.pptx$/i.test(file.name) || file.size > 50 * 1024 * 1024) return Response.json({ error: "Use a .pptx under 50 MB" }, { status: 400 });
    const imported = importPresentationPptx(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.pptx$/i, ""));
    const media = new Map<string, string>();
    for (const item of imported.media) {
      const attachment = await saveAttachment({ file: new File([new Uint8Array(item.bytes)], item.name.split("/").pop()!, { type: item.mime }), entityType: "wikiPresentation", entityId: id, userId: session.user.id });
      media.set(item.key, attachment.id);
    }
    const { snapshot } = imported;
    snapshot.elements = snapshot.elements.map((element) => element.type === "image" ? { ...element, content: { ...element.content, attachmentId: media.get(element.content.attachmentId)! } } : element);
    db.insert(wikiPresentations).values({ id, title: snapshot.title, elementsJson: JSON.stringify({ elements: snapshot.elements, background: snapshot.background, settings: snapshot.settings }), pathJson: JSON.stringify(snapshot.steps), createdBy: session.user.id, updatedBy: session.user.id }).run();
    revalidatePath("/wiki/presentations");
    return Response.json({ id, warnings: imported.warnings });
  } catch { deleteAttachmentsFor("wikiPresentation", id); return Response.json({ error: "Invalid or unsupported PowerPoint file" }, { status: 422 }); }
}
