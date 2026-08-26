import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;
const webServerCommand =
  process.env.PLAYWRIGHT_SERVER_COMMAND ??
  `node e2e/reset-db.mjs && npm run dev -- -p ${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // The suite runs against a dev server that compiles each route on first visit, so the
  // first assertion after a navigation can take several seconds -- a cold login lands
  // around 9s. The 5s default made that look like a failure.
  expect: { timeout: 25_000 },
  // Single worker: all spec files share one dev server and SQLite database,
  // and the accounting spec bootstraps the admin account the others reuse.
  workers: 1,
  use: {
    baseURL,
  },
  webServer:
    process.env.PLAYWRIGHT_EXTERNAL_SERVER === "true"
      ? undefined
      : {
          command: webServerCommand,
          url: `${baseURL}/login`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            PORT: String(port),
            HOSTNAME: "127.0.0.1",
            DATABASE_PATH: path.resolve("data/e2e.db"),
            UPLOADS_PATH: path.resolve("data/e2e-uploads"),
            BETTER_AUTH_URL: baseURL,
            BETTER_AUTH_SECRET:
              "e2e-only-secret-not-for-production-32-bytes-minimum",
            E2E_TEST: "true",
          },
        },
});
