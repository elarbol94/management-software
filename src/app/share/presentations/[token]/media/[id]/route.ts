import fs from "node:fs";
import { Readable } from "node:stream";
import { publicPresentation, presentationMediaIds } from "@/modules/wiki/presentation-delivery";
import { getAttachment, getAttachmentAbsolutePath } from "@/lib/files";
import { parseByteRange } from "@/lib/http-range";

async function serve(request: Request, params: Promise<{ token: string; id: string }>, head = false) {
  const { token, id } = await params;
  const presentation = publicPresentation(token);
  const attachment = presentation && presentationMediaIds(presentation).has(id) ? getAttachment(id) : null;
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; sandbox" });
  if (!attachment || !/^(image|audio|video)\//.test(attachment.mimeType)) return new Response(null, { status: 404, headers });
  const path = getAttachmentAbsolutePath(attachment.storedName);
  let size: number;
  try { size = (await fs.promises.stat(path)).size; } catch { return new Response(null, { status: 404, headers }); }
  const rangeHeader = request.headers.get("range");
  const range = parseByteRange(rangeHeader, size);
  if (rangeHeader && !range) { headers.set("Content-Range", `bytes */${size}`); return new Response(null, { status: 416, headers }); }
  const start = range?.start ?? 0, end = range?.end ?? size - 1;
  headers.set("Content-Type", attachment.mimeType); headers.set("Accept-Ranges", "bytes"); headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (attachment.mimeType === "image/svg+xml" && attachment.storedName.endsWith(".svgz")) headers.set("Content-Encoding", "gzip");
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  return new Response(head || size === 0 ? null : Readable.toWeb(fs.createReadStream(path, { start, end })) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
export async function GET(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) { return serve(request, params); }
export async function HEAD(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) { return serve(request, params, true); }
