import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { db } from "./index";

export function runMigrations() {
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

// Run directly via `npm run db:migrate`
if (process.argv[1] && path.basename(process.argv[1]).startsWith("migrate")) {
  runMigrations();
  console.log("Migrations applied.");
}
