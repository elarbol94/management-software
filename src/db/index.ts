import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const dbPath =
  process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// Keep a single connection across Next.js dev-mode HMR reloads.
const globalForDb = globalThis as unknown as { sqlite?: Database.Database };

const sqlite =
  globalForDb.sqlite ??
  (() => {
    const conn = new Database(dbPath);
    // Set the busy timeout first: switching the journal mode needs a lock of its own, so
    // a concurrent writer makes the open itself fail with SQLITE_BUSY otherwise.
    conn.pragma("busy_timeout = 5000");
    conn.pragma("journal_mode = WAL");
    conn.pragma("foreign_keys = ON");
    conn.pragma("synchronous = NORMAL");
    conn.pragma("temp_store = MEMORY");
    conn.pragma("cache_size = -32768");
    conn.pragma("mmap_size = 268435456");
    conn.pragma("wal_autocheckpoint = 1000");
    conn.pragma("optimize");
    return conn;
  })();

if (process.env.NODE_ENV !== "production") globalForDb.sqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { sqlite };
