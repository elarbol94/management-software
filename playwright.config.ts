import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // Single worker: all spec files share one dev server and SQLite database,
  // and the accounting spec bootstraps the admin account the others reuse.
  workers: 1,
  use: {
    baseURL,
  },
  webServer: {
    command: `node e2e/reset-db.mjs && npm run dev -- -p ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_PATH: "./data/e2e.db",
      UPLOADS_PATH: "./data/e2e-uploads",
      BETTER_AUTH_URL: baseURL,
    },
  },
});
