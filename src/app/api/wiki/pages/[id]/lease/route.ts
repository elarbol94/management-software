import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  acquirePageEditLease,
  heartbeatPageEditLease,
  releasePageEditLease,
} from "@/modules/wiki/actions";

const requestSchema = z.object({
  sessionId: z.string().min(8).max(200),
  action: z.enum(["acquire", "heartbeat", "takeover", "release"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await getSession()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [{ id }, input] = await Promise.all([params, request.json()]);
    const data = requestSchema.parse(input);
    if (data.action === "release") {
      return NextResponse.json(await releasePageEditLease({ pageId: id, sessionId: data.sessionId }));
    }
    if (data.action === "heartbeat") {
      return NextResponse.json(await heartbeatPageEditLease({ pageId: id, sessionId: data.sessionId }));
    }
    return NextResponse.json(await acquirePageEditLease({
      pageId: id,
      sessionId: data.sessionId,
      takeover: data.action === "takeover",
    }));
  } catch {
    return NextResponse.json({ error: "Invalid edit lease request" }, { status: 400 });
  }
}
