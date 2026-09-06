async function warmLanguageTool() {
  const baseUrl = process.env.LANGUAGETOOL_URL;
  if (!baseUrl) return;
  const endpoint = new URL("/v2/check", baseUrl);
  await Promise.allSettled((["de-DE", "de-AT", "en-US"] as const).map((language) => fetch(endpoint, {
    method: "POST",
    body: new URLSearchParams({ text: language === "en-US" ? "The proofing service is ready." : "Die Prüfung ist bereit.", language, enabledOnly: "false" }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  })));
}

// Runs once when the Next.js server boots (dev and production).
// Applies migrations and starts the durable local PDF extraction worker.
export async function register() {
  // `next build` imports route modules in parallel workers; letting each one migrate and
  // seed the same SQLite file deadlocks the build (and would touch the dev database).
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runMigrations } = await import("./db/migrate");
    runMigrations();
    const { seedDefaults } = await import("./db/seed");
    seedDefaults();
    const { cleanupPerformanceEvents } = await import("./lib/performance");
    cleanupPerformanceEvents();
    await warmLanguageTool();
    const { startPdfProcessingWorker } = await import("./modules/wiki/pdf-processing");
    startPdfProcessingWorker();
    const { startFigureSyncWorker } = await import("./modules/wiki/figure-assets");
    startFigureSyncWorker();
  }
}
