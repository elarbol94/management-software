// Runs once when the Next.js server boots (dev and production).
// Applies pending Drizzle migrations so the SQLite file is always current.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./db/migrate");
    runMigrations();
    const { seedDefaults } = await import("./db/seed");
    seedDefaults();
  }
}
