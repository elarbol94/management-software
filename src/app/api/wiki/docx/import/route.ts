import mammoth from "mammoth";
import { getSession } from "@/lib/auth";
import { docxHtmlToTiptap } from "@/modules/wiki/lib/docx-import";

export async function POST(request: Request) {
  if (!await getSession()) return new Response("Unauthorized", { status: 401 });
  try {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) return Response.json({ error: "Invalid DOCX file" }, { status: 400 });
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(await file.arrayBuffer()) });
  return Response.json({ document: docxHtmlToTiptap(result.value), warnings: result.messages.map((message) => message.message) });
  } catch {
    return Response.json({ error: "Invalid DOCX file" }, { status: 400 });
  }
}
