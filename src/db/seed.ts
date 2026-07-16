import { count } from "drizzle-orm";
import path from "node:path";
import { db } from "./index";
import { categories } from "./schema";

// Category names are user data (editable in settings), seeded in German for
// the Austrian E/A-Rechnung context.
const defaultCategories: Array<{
  name: string;
  kind: "income" | "expense";
  color: string;
}> = [
  { name: "Erlöse 20 % USt", kind: "income", color: "#16a34a" },
  { name: "Erlöse 13 % USt", kind: "income", color: "#15803d" },
  { name: "Erlöse 10 % USt", kind: "income", color: "#166534" },
  { name: "Förderungen", kind: "income", color: "#0d9488" },
  { name: "Sonstige Erlöse", kind: "income", color: "#65a30d" },
  { name: "Wareneinkauf", kind: "expense", color: "#dc2626" },
  { name: "Fremdleistungen", kind: "expense", color: "#ea580c" },
  { name: "Miete", kind: "expense", color: "#d97706" },
  { name: "Strom & Energie", kind: "expense", color: "#ca8a04" },
  { name: "Telefon & Internet", kind: "expense", color: "#0891b2" },
  { name: "Software & Hosting", kind: "expense", color: "#0284c7" },
  { name: "Büromaterial", kind: "expense", color: "#7c3aed" },
  { name: "Fachliteratur", kind: "expense", color: "#9333ea" },
  { name: "Reisekosten", kind: "expense", color: "#c026d3" },
  { name: "Bewirtung", kind: "expense", color: "#db2777" },
  { name: "KFZ-Kosten", kind: "expense", color: "#e11d48" },
  { name: "Versicherungen", kind: "expense", color: "#475569" },
  { name: "Sozialversicherung (SVS)", kind: "expense", color: "#64748b" },
  { name: "Steuern & Abgaben", kind: "expense", color: "#78716c" },
  { name: "Bankspesen", kind: "expense", color: "#57534e" },
  { name: "Werbung & Marketing", kind: "expense", color: "#2563eb" },
  { name: "GWG (geringwertige Wirtschaftsgüter)", kind: "expense", color: "#4f46e5" },
  { name: "Sonstige Ausgaben", kind: "expense", color: "#6b7280" },
];

/** Idempotent: only seeds when the categories table is empty. */
export function seedDefaults() {
  const existing =
    db.select({ value: count() }).from(categories).get()?.value ?? 0;
  if (existing > 0) return false;

  db.insert(categories)
    .values(
      defaultCategories.map((category, index) => ({
        ...category,
        sortOrder: (index + 1) * 10,
      })),
    )
    .run();
  return true;
}

// Run directly via `npm run db:seed`
if (process.argv[1] && path.basename(process.argv[1]).startsWith("seed")) {
  const seeded = seedDefaults();
  console.log(seeded ? "Default categories seeded." : "Categories already present, nothing to do.");
}
