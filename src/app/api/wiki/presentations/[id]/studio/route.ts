import { z } from "zod";
import { getSession } from "@/lib/auth";
import { PresentationAccessError } from "@/modules/wiki/presentation-access";
import { changePresentationStudio, getPresentationStudio } from "@/modules/wiki/presentation-studio";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  if (!await getSession()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json(await getPresentationStudio((await params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: "Unavailable" }, { status: error instanceof PresentationAccessError ? 403 : 500 }); }
}
export async function POST(request: Request, { params }: Context) {
  if (!await getSession()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON required" }, { status: 415 });
  try { return Response.json(await changePresentationStudio((await params).id, await request.json())); }
  catch (error) { return Response.json({ error: "Could not update presentation" }, { status: error instanceof PresentationAccessError ? 403 : error instanceof z.ZodError ? 400 : 500 }); }
}
