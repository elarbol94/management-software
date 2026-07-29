import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listSvgAssets, restoreSvgAsset, updateSvgAsset } from "@/modules/wiki/svg-assets";

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
