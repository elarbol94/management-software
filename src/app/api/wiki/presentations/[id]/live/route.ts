import { z } from "zod";
import { getSession } from "@/lib/auth";
import { liveSessionCodeSchema, liveStepIndexSchema } from "@/modules/wiki/lib/live-session";
import { publishPresentationLivePosition, startPresentationLiveSession, stopPresentationLiveSession } from "@/modules/wiki/presentation-live-actions";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), stepIndex: liveStepIndexSchema.default(0) }),
  z.object({ action: z.literal("publish"), code: liveSessionCodeSchema, stepIndex: liveStepIndexSchema }),
  z.object({ action: z.literal("stop"), code: liveSessionCodeSchema }),
]);

/** The actions retain the host/code ownership checks; transport does not depend on a page. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return Response.json({ error: "Forbidden" }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "JSON required" }, { status: 415 });
  }
  try {
    const command = commandSchema.parse(await request.json());
    const { id: presentationId } = await params;
    if (command.action === "start") return Response.json(await startPresentationLiveSession({ presentationId, stepIndex: command.stepIndex }));
    if (command.action === "publish") return Response.json(await publishPresentationLivePosition({ presentationId, code: command.code, stepIndex: command.stepIndex }));
    return Response.json(await stopPresentationLiveSession({ presentationId, code: command.code }));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json({ error: "Invalid live session request" }, { status: 400 });
    }
    return Response.json({ error: "Live session request failed" }, { status: 500 });
  }
}
