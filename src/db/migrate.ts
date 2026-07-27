import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

export async function runMigrations() {
  // The app loads .env.local through Next.js; do the same for standalone
  // migrations so they always target the database used by the running app.
  loadEnvConfig(process.cwd(), true);
  const { db } = await import("./index");
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

// Run directly via `npm run db:migrate`
if (process.argv[1] && path.basename(process.argv[1]).startsWith("migrate")) {
  void runMigrations().then(() => {
    console.log("Migrations applied.");
  });
}
