import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listSvgAssets, restoreSvgAsset, syncSvgAssetsFromFolder, updateSvgAsset } from "@/modules/wiki/svg-assets";

const MAX_SYNC_FILES = 500;

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  action: z.literal("update"),
  assetId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  layers: z.array(z.object({
    id: z.string().min(1).max(120),
    text: z.string().max(10_000),
    binding: z.string().max(50),
  })).max(1_000),
  sizeScale: z.number().min(0.25).max(4).nullish(),
});
const restoreSchema = z.object({
  action: z.literal("restore"),
  assetId: z.string().min(1),
  revisionId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
});

export async function GET(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ assets: listSvgAssets(id, session.user.id) });
  } catch {
    return NextResponse.json({ error: "SVG assets could not be loaded" }, { status: 400 });
  }
}

/** Folder sync: multipart `files` plus a matching `paths` entry per file. */
export async function POST(request: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [{ id }, formData] = await Promise.all([params, request.formData()]);
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  const paths = formData.getAll("paths");
  if (
    !files.length ||
    files.length > MAX_SYNC_FILES ||
    files.length !== paths.length ||
    paths.some((path) => typeof path !== "string" || !path || path.length > 400)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    return NextResponse.json(await syncSvgAssetsFromFolder({
      pageId: id,
      userId: session.user.id,
      files: files.map((file, index) => ({ path: String(paths[index]), file })),
    }));
  } catch {
    return NextResponse.json({ error: "Folder could not be imported" }, { status: 400 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [{ id }, input] = await Promise.all([params, request.json()]);
    const action = z.discriminatedUnion("action", [updateSchema, restoreSchema]).parse({
      action: (input as { action?: unknown }).action ?? "update",
      ...(input as object),
    });
    if (action.action === "restore") {
      return NextResponse.json(restoreSvgAsset({ pageId: id, userId: session.user.id, ...action }));
    }
    return NextResponse.json(updateSvgAsset({ pageId: id, userId: session.user.id, ...action }));
  } catch {
    return NextResponse.json({ error: "SVG asset could not be saved" }, { status: 400 });
  }
}
