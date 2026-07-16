import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // Single worker: all spec files share one dev server and SQLite database,
  // and the accounting spec bootstraps the admin account the others reuse.
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
  },
  webServer: {
    command: "node e2e/reset-db.mjs && npm run dev -- -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_PATH: "./data/e2e.db",
      UPLOADS_PATH: "./data/e2e-uploads",
      BETTER_AUTH_URL: "http://localhost:3100",
    },
  },
});
