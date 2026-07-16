import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listEntries } from "@/modules/accounting/queries";
import { buildEntriesCsv } from "@/modules/accounting/lib/csv";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const monthParam = url.searchParams.get("month");
  const month = monthParam ? Number(monthParam) : undefined;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  }

  const rows = listEntries({ year, month });
  // CSV rows are ordered oldest first for the tax advisor.
  const csv = buildEntriesCsv([...rows].reverse());

  const filename = month
    ? `buchhaltung-${year}-${String(month).padStart(2, "0")}.csv`
    : `buchhaltung-${year}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
