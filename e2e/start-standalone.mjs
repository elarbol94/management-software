// Keeps the disposable database reset and the standalone Next server in one
// process so Playwright can reliably tear the server down on Windows.
await import("./reset-db.mjs");
await import("../.next/standalone/server.js");
