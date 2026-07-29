import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseBibTeX, parseRis } from "@/modules/wiki/lib/interchange";

const MAX_IMPORT_BYTES = 2_000_000;

export async function POST(request: Request) {
  if (!await getSession()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid import form" }, { status: 400 });
  }

  const file = data.get("file");
  if (
    !(file instanceof File)
    || file.size === 0
    || file.size > MAX_IMPORT_BYTES
  ) {
    return NextResponse.json(
      { error: "Invalid or oversized import" },
      { status: 400 },
    );
  }

  const lower = file.name.toLowerCase();
  if (
    !lower.endsWith(".ris")
    && !lower.endsWith(".bib")
    && !lower.endsWith(".bibtex")
  ) {
    return NextResponse.json(
      { error: "Only BibTeX and RIS files are supported" },
      { status: 400 },
    );
  }

  try {
    const text = await file.text();
    const records = lower.endsWith(".ris")
      ? parseRis(text)
      : parseBibTeX(text);
    if (records.length === 0) {
      return NextResponse.json(
        { error: "No supported bibliography records were found" },
        { status: 400 },
      );
    }
    return NextResponse.json({ records, count: records.length });
  } catch {
    return NextResponse.json(
      { error: "The library file could not be parsed" },
      { status: 400 },
    );
  }
}
