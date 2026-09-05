import { z } from "zod";
import { getSession } from "@/lib/auth";
import { acquirePresentationEditLease, heartbeatPresentationEditLease, releasePresentationEditLease } from "@/modules/wiki/presentation-actions";

const leaseSchema = z.object({
  sessionId: z.string().min(8).max(200),
  action: z.enum(["acquire", "takeover", "heartbeat", "release"]).default("release"),
});

/** Lease operations remain independent of the route being entered or left. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "JSON required" }, { status: 415 });
  }
  try {
    const { sessionId, action } = leaseSchema.parse(await request.json());
    const { id } = await params;
    if (action === "acquire" || action === "takeover") return Response.json(await acquirePresentationEditLease({ id, sessionId, takeover: action === "takeover" }));
    if (action === "heartbeat") return Response.json(await heartbeatPresentationEditLease({ id, sessionId }));
    return Response.json(await releasePresentationEditLease({ id, sessionId }));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "Invalid edit lease request" }, { status: 400 });
    }
    return Response.json({ error: "Edit lease request failed" }, { status: 500 });
  }
}
