import { z } from "zod";
import { getSession } from "@/lib/auth";
import { releasePresentationEditLease } from "@/modules/wiki/presentation-actions";

const releaseSchema = z.object({ sessionId: z.string().min(8).max(200) });

/** Release only this user's matching editor lease, even after client navigation. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "JSON required" }, { status: 415 });
  }
  try {
    const { sessionId } = releaseSchema.parse(await request.json());
    const { id } = await params;
    return Response.json(await releasePresentationEditLease({ id, sessionId }));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "Invalid edit lease request" }, { status: 400 });
    }
    return Response.json({ error: "Could not release edit lease" }, { status: 500 });
  }
}
