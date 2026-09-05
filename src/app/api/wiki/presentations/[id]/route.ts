import { z } from "zod";
import { getSession } from "@/lib/auth";
import { savePresentation } from "@/modules/wiki/presentation-actions";
import { getPresentation } from "@/modules/wiki/presentation-queries";
import { PresentationAccessError } from "@/modules/wiki/presentation-access";

const draftSchema = z.object({
  elements: z.unknown(),
  steps: z.unknown(),
  sessionId: z.string().min(8).max(200),
  expectedUpdatedAt: z.number().int().nonnegative(),
  title: z.string().optional(),
  background: z.unknown().optional(),
  settings: z.unknown().optional(),
  base: z.unknown().optional(),
});

/** A fixed endpoint for a final save after client navigation has unmounted the editor.
 * PATCH + JSON cannot be submitted by a cross-origin HTML form. No CORS is enabled. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "JSON required" }, { status: 415 });
  }
  try {
    const data = draftSchema.parse(await request.json());
    const { id } = await params;
    const result = await savePresentation({ ...data, id });
    return Response.json(result, { status: result.locked || result.conflict ? 409 : 200 });
  } catch (error) {
    if (error instanceof PresentationAccessError) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "Invalid presentation" }, { status: 400 });
    }
    return Response.json({ error: "Could not save presentation" }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const presentation = getPresentation((await params).id, session.user);
  if (!presentation) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(presentation, { headers: { "Cache-Control": "no-store" } });
}
