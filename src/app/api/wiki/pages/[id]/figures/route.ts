import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUserOrThrow } from "@/lib/auth";
import { editableFigureCopy, adoptFigureAttachment, changeFigureAsset, createFigureSource, figureManifest, publishFigure, refreshServerFigures, requireFigurePage, syncServerFigure } from "@/modules/wiki/figure-assets";
import { MAX_UPLOAD_BYTES } from "@/lib/files";

type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  const code = error instanceof z.ZodError ? "invalidInput" : error instanceof Error ? error.message : "invalidFile";
  const allowed = new Set(["Unauthorized", "notFound", "forbidden", "versionConflict", "sourceConflict", "sourceUnavailable", "invalidPath", "invalidFile", "invalidInput", "sidecarConflict", "invalidSidecar", "fileChanging"]);
  return Response.json({ error: allowed.has(code) ? code : "invalidFile" }, { status: code === "Unauthorized" ? 401 : code === "forbidden" ? 403 : code === "notFound" ? 404 : code === "versionConflict" || code === "sourceConflict" ? 409 : 400 });
}
export async function GET(_request: Request, { params }: Context) {
  try {
    const currentUser = await requireUserOrThrow();
    const { id } = await params;
    return Response.json(figureManifest(id, currentUser.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("source"), source: z.unknown() }),
  z.object({ action: z.literal("link"), sourceId: z.string().min(1), path: z.string().min(1).max(1000), assetId: z.string().optional() }),
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("editableCopy"), assetId: z.string().min(1), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("adopt"), attachmentId: z.string().min(1) }),
]);
export async function POST(request: Request, { params }: Context) {
  try {
    const currentUser = await requireUserOrThrow();
    const { id } = await params;
    requireFigurePage(id);
    let result: unknown;
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES + 200_000) throw new Error("invalidFile");
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("invalidFile");
      const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)) : undefined;
      const input = z.object({ sourceId: z.string().min(1).optional(), relativePath: z.string().max(1000).optional(), assetId: z.string().min(1).optional(), expectedVersion: z.coerce.number().int().positive().optional(), sidecar: z.string().max(100_000).optional() }).parse({ sourceId: text("sourceId"), relativePath: text("path"), assetId: text("assetId"), expectedVersion: text("expectedVersion"), sidecar: text("sidecar") });
      // Server sources must be read by the server, never replaced with arbitrary uploaded bytes.
      if (input.sourceId && figureManifest(id, currentUser.id).sources.find((source) => source.id === input.sourceId)?.kind !== "laptop") throw new Error("forbidden");
      result = await publishFigure({ pageId: id, userId: currentUser.id, file, ...input });
    } else {
      const data = commandSchema.parse(await request.json());
      if (data.action === "source") result = createFigureSource(id, currentUser.id, data.source);
      if (data.action === "link") result = await syncServerFigure(id, data.sourceId, data.path, currentUser.id, data.assetId);
      if (data.action === "editableCopy") result = await editableFigureCopy(id, currentUser.id, data.assetId, data.expectedVersion);
      if (data.action === "adopt") result = await adoptFigureAttachment(id, currentUser.id, data.attachmentId);
      if (data.action === "refresh") { await refreshServerFigures(id); result = { refreshed: true }; }
    }
    revalidatePath("/wiki", "layout");
    return Response.json({ result, ...figureManifest(id, currentUser.id) });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const currentUser = await requireUserOrThrow();
    const { id } = await params;
    const result = await changeFigureAsset(id, currentUser.id, await request.json());
    revalidatePath("/wiki", "layout");
    return Response.json({ result, ...figureManifest(id, currentUser.id) });
  } catch (error) { return failure(error); }
}
