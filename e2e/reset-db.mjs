// Runs before the e2e dev server starts (see playwright.config.ts webServer
// command): wipes the e2e database and uploads so every run starts clean.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

for (const name of ["e2e.db", "e2e.db-wal", "e2e.db-shm"]) {
  const file = path.join(dataDir, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
const uploads = path.join(dataDir, "e2e-uploads");
if (fs.existsSync(uploads)) fs.rmSync(uploads, { recursive: true });
console.log("e2e database reset");
