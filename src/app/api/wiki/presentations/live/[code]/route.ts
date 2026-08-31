import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { liveSessionCodeSchema } from "@/modules/wiki/lib/live-session";
import { getLiveSessionByCode } from "@/modules/wiki/presentation-queries";

/**
 * The follower poll. A GET rather than a server action because followers hit it every
 * couple of seconds and it neither mutates nor revalidates anything. Presentations are
 * not public: an unauthenticated poll gets a 401 like every other wiki read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!await getSession()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = liveSessionCodeSchema.safeParse((await params).code);
  if (!parsed.success) return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const session = getLiveSessionByCode(parsed.data);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { stepIndex: session.stepIndex, live: session.live },
    { headers: { "Cache-Control": "no-store" } },
  );
}
