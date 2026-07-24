// Runs once when the Next.js server boots (dev and production).
// Applies migrations and starts the durable local PDF extraction worker.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./db/migrate");
    runMigrations();
    const { seedDefaults } = await import("./db/seed");
    seedDefaults();
    const { cleanupPerformanceEvents } = await import("./lib/performance");
    cleanupPerformanceEvents();
    const { startPdfProcessingWorker } = await import("./modules/wiki/pdf-processing");
    startPdfProcessingWorker();
  }
}
