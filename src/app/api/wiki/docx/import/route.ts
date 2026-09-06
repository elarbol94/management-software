import mammoth from "mammoth";
import { requireUserOrThrow } from "@/lib/auth";
import { deleteAttachment, saveAttachment } from "@/lib/files";
import { requireFigurePage, validateFigureFile } from "@/modules/wiki/figure-assets";
import { docxHtmlToTiptap } from "@/modules/wiki/lib/docx-import";

export async function POST(request: Request) {
  const created: string[] = [];
  try {
    const currentUser = await requireUserOrThrow();
    const form = await request.formData();
    const file = form.get("file");
    const pageId = String(form.get("pageId") || "");
    requireFigurePage(pageId);
    if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) return Response.json({ error: "Invalid DOCX file" }, { status: 400 });
    let total = 0;
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(await file.arrayBuffer()) }, {
      styleMap: ["p[style-name='Caption'] => p.figure-caption:fresh", "p[style-name='Beschriftung'] => p.figure-caption:fresh"],
      convertImage: mammoth.images.imgElement(async (image) => {
        const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" } as Record<string, string>)[image.contentType];
        if (!extension) throw new Error("Unsupported embedded image");
        const bytes = await image.read();
        total += bytes.byteLength;
        if (total > 50 * 1024 * 1024) throw new Error("Embedded images exceed the size limit");
        const imageFile = await validateFigureFile(new File([new Uint8Array(bytes)], `word-image-${created.length + 1}.${extension}`, { type: image.contentType }));
        const attachment = await saveAttachment({ file: imageFile, entityType: "wikiPage", entityId: pageId, userId: currentUser.id });
        created.push(attachment.id);
        return { src: `/api/files/${attachment.id}` };
      }),
    });
    return Response.json({ document: docxHtmlToTiptap(result.value), warnings: result.messages.map((message) => message.message) });
  } catch (error) {
    created.forEach(deleteAttachment);
    return Response.json({ error: error instanceof Error && error.message === "Unauthorized" ? "Unauthorized" : "Invalid DOCX file" }, { status: error instanceof Error && error.message === "Unauthorized" ? 401 : 400 });
  }
}
