import { and, eq } from "drizzle-orm";
import path from "node:path";
import { db } from "./index";
import { categories } from "./schema";

// Category names are user data (editable in settings), seeded in German for
// the Austrian E/A-Rechnung context.
const defaultCategories: Array<{
  name: string;
  kind: "income" | "expense";
  color: string;
  template?:
    | "standard_income"
    | "grant_income"
    | "standard_expense"
    | "hospitality"
    | "travel"
    | "vehicle"
    | "asset"
    | "personnel"
    | "svs"
    | "tax_levy";
}> = [
  { name: "Erlöse 20 % USt", kind: "income", color: "#16a34a", template: "standard_income" },
  { name: "Erlöse 13 % USt", kind: "income", color: "#15803d", template: "standard_income" },
  { name: "Erlöse 10 % USt", kind: "income", color: "#166534", template: "standard_income" },
  { name: "Förderungen", kind: "income", color: "#0d9488", template: "grant_income" },
  { name: "Sonstige Erlöse", kind: "income", color: "#65a30d", template: "standard_income" },
  { name: "Wareneinkauf", kind: "expense", color: "#dc2626" },
  { name: "Fremdleistungen", kind: "expense", color: "#ea580c" },
  { name: "Miete", kind: "expense", color: "#d97706" },
  { name: "Strom & Energie", kind: "expense", color: "#ca8a04" },
  { name: "Telefon & Internet", kind: "expense", color: "#0891b2" },
  { name: "Software & Hosting", kind: "expense", color: "#0284c7" },
  { name: "Büromaterial", kind: "expense", color: "#7c3aed" },
  { name: "Fachliteratur", kind: "expense", color: "#9333ea" },
  { name: "Reisekosten", kind: "expense", color: "#c026d3", template: "travel" },
  { name: "Bewirtung", kind: "expense", color: "#db2777", template: "hospitality" },
  { name: "KFZ-Kosten", kind: "expense", color: "#e11d48", template: "vehicle" },
  { name: "Versicherungen", kind: "expense", color: "#475569" },
  { name: "Sozialversicherung (SVS)", kind: "expense", color: "#64748b", template: "svs" },
  { name: "Personalkosten", kind: "expense", color: "#8b5e3c", template: "personnel" },
  { name: "Steuern & Abgaben", kind: "expense", color: "#78716c", template: "tax_levy" },
  { name: "Bankspesen", kind: "expense", color: "#57534e" },
  { name: "Werbung & Marketing", kind: "expense", color: "#2563eb" },
  { name: "GWG (geringwertige Wirtschaftsgüter)", kind: "expense", color: "#4f46e5", template: "asset" },
  { name: "Sonstige Ausgaben", kind: "expense", color: "#6b7280" },
];

/** Idempotent: adds missing defaults without touching renamed or custom categories. */
export function seedDefaults() {
  let added = 0;
  db.transaction((tx) => {
    defaultCategories.forEach((category, index) => {
      const exists = tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.name, category.name), eq(categories.kind, category.kind)))
        .get();
      if (exists) return;
      tx.insert(categories).values({
        ...category,
        template:
          category.template ??
          (category.kind === "income" ? "standard_income" : "standard_expense"),
        sortOrder: (index + 1) * 10,
      }).run();
      added += 1;
    });
  });
  return added;
}

// Run directly via `npm run db:seed`
if (process.argv[1] && path.basename(process.argv[1]).startsWith("seed")) {
  const seeded = seedDefaults();
  console.log(seeded ? `${seeded} default categories seeded.` : "Default categories already present.");
}
